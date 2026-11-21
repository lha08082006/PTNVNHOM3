// lib/staff.js - Tài khoản nhân viên nội bộ, phân quyền theo vai trò và nhật ký thao tác
//   MANAGER    : Quản lý – toàn quyền, quản lý nhân sự, xem nhật ký, công cụ IT
//   ACCOUNTANT : Kế toán – duyệt chi / trả về hồ sơ hoàn tiền, báo cáo đối soát
//   CS         : Nhân viên CSKH – phiếu hỗ trợ, đối chiếu & gửi hồ sơ hoàn tiền sang Kế toán
//   COUNTER    : Nhân viên quầy – tra cứu đơn / vé
const Store = require('./store');
const Auth = require('./auth');
const Throttle = require('./throttle');
const TOTP = require('./totp');

const ROLES = {
  MANAGER: 'Quản lý',
  ACCOUNTANT: 'Kế toán',
  CS: 'Nhân viên CSKH',
  COUNTER: 'Nhân viên quầy'
};

// Quyền theo vai trò. MANAGER có mọi quyền.
const PERMS = {
  ACCOUNTANT: ['order.view', 'refund.view', 'refund.pay', 'refund.return', 'report.view'],
  CS: ['order.view', 'refund.view', 'refund.decide', 'refund.send', 'refund.remind', 'refund.confirm', 'ticket.view', 'ticket.resolve'],
  COUNTER: ['order.view', 'ticket.checkin']
};
const can = (staff, perm) => !!staff && (staff.role === 'MANAGER' || (PERMS[staff.role] || []).includes(perm));
const permsOf = (role) => role === 'MANAGER' ? ['*'] : (PERMS[role] || []);

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // phiên nhân viên: 12 giờ (1 ca làm)
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const normEmail = (s) => String(s || '').trim().toLowerCase();

const publicStaff = (s) => s && ({
  id: s.id, email: s.email, full_name: s.full_name, role: s.role, role_label: ROLES[s.role], totp_enabled: !!s.totp_enabled,
  active: s.active !== false, last_login_at: s.last_login_at || null, created_at: s.created_at, perms: permsOf(s.role)
});

function validate({ email, full_name, role, password }, { partial = false } = {}) {
  if (!partial || email !== undefined) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(email))) throw httpError('Email không hợp lệ', 400); }
  if (!partial || full_name !== undefined) { if (String(full_name || '').trim().length < 2) throw httpError('Vui lòng nhập họ tên', 400); }
  if (!partial || role !== undefined) { if (!ROLES[role]) throw httpError('Vai trò không hợp lệ', 400); }
  if (!partial || password !== undefined) { if (String(password || '').length < 8) throw httpError('Mật khẩu cần ít nhất 8 ký tự', 400); }
}

async function create({ email, full_name, role, password }) {
  validate({ email, full_name, role, password });
  if (await Store.one('staff', { email: normEmail(email) })) throw httpError('Email này đã có tài khoản nhân viên', 409);
  const s = await Store.insert('staff', {
    email: normEmail(email), full_name: String(full_name).trim().slice(0, 80), role, active: true,
    password_hash: Auth.hashPassword(password)
  });
  return publicStaff(s);
}

async function login(email, password, otp) {
  const tkey = 's:' + normEmail(email);
  await Throttle.check(tkey);
  const s = await Store.one('staff', { email: normEmail(email) });
  if (!s || !Auth.verifyPassword(password, s.password_hash)) { await Throttle.fail(tkey); throw httpError('Sai email hoặc mật khẩu', 401); }
  if (s.active === false) throw httpError('Tài khoản đã bị khóa. Liên hệ Quản lý.', 403);
  // Đăng nhập 2 lớp (Đợt 6): đã bật thì bắt buộc mã 6 số; sai mã tính chung vào giới hạn 5 lần / 15 phút
  if (s.totp_enabled) {
    if (!otp) throw Object.assign(httpError('Nhập mã 6 số trong ứng dụng xác thực', 401), { need_otp: true });
    const step = TOTP.verify(TOTP.open(s.totp_secret, Auth.secret()), otp);
    if (step == null || step <= Number(s.totp_last_step || -1)) { await Throttle.fail(tkey); throw Object.assign(httpError('Mã xác thực không đúng hoặc đã dùng', 401), { need_otp: true }); }
    await Store.update('staff', { id: s.id }, { totp_last_step: step });
  }
  await Throttle.reset(tkey);
  await Store.update('staff', { id: s.id }, { last_login_at: new Date().toISOString() });
  const token = Auth.sign({ sub: s.id, typ: 'staff', v: Auth.pwVersion(s), exp: Date.now() + TOKEN_TTL_MS });
  return { token, staff: publicStaff(s) };
}

// Nhân viên đang đăng nhập (Authorization: Bearer <token nhân viên>), hoặc null
async function current(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String((req.headers && req.headers.authorization) || ''));
  const p = m && Auth.verifyToken(m[1]);
  if (!p || p.typ !== 'staff') return null;
  const s = await Store.one('staff', { id: p.sub });
  if (!s || s.active === false || p.v !== Auth.pwVersion(s)) return null;
  return s;
}

// Kiểm tra đăng nhập + quyền; tự trả lỗi 401/403 và trả null nếu không đạt
async function guard(req, res, perm) {
  const s = await current(req);
  if (!s) { res.status(401).json({ ok: false, error: 'Phiên đăng nhập nội bộ đã hết hạn, vui lòng đăng nhập lại' }); return null; }
  if (perm && !can(s, perm)) { res.status(403).json({ ok: false, error: `Vai trò ${ROLES[s.role]} không có quyền thực hiện thao tác này` }); return null; }
  return s;
}

async function update(id, { full_name, role, active, password }, by) {
  const s = await Store.one('staff', { id });
  if (!s) throw httpError('Không tìm thấy nhân viên', 404);
  validate({ full_name, role, password }, { partial: true });
  if (by && by.id === id && (active === false || (role && role !== 'MANAGER'))) throw httpError('Không thể tự khóa hoặc tự hạ quyền tài khoản của chính mình', 400);
  const patch = {};
  if (full_name !== undefined) patch.full_name = String(full_name).trim().slice(0, 80);
  if (role !== undefined) patch.role = role;
  if (active !== undefined) patch.active = !!active;
  if (password) patch.password_hash = Auth.hashPassword(password); // đổi mật khẩu = đăng xuất mọi phiên cũ
  const [row] = await Store.update('staff', { id }, patch);
  return publicStaff(row);
}

// ---- Đăng nhập 2 lớp: bật / tắt (Đợt 6) ----
// B1 totpSetup: tạo khóa mới (chưa bật) -> trả mã + đường dẫn otpauth để quét QR
// B2 totpEnable: nhập đúng mã 6 số từ ứng dụng -> bật
async function totpSetup(s) {
  if (!Auth.secret()) throw httpError('Chưa cấu hình AUTH_SECRET', 503);
  const secret = TOTP.newSecret();
  await Store.update('staff', { id: s.id }, { totp_pending: TOTP.seal(secret, Auth.secret()) });
  return { secret, otpauth: TOTP.otpauthUrl(secret, s.email) };
}
async function totpEnable(s, code) {
  const fresh = await Store.one('staff', { id: s.id });
  const secret = TOTP.open(fresh.totp_pending, Auth.secret());
  if (!secret) throw httpError('Hãy bấm "Thiết lập" để tạo mã QR trước', 400);
  const step = TOTP.verify(secret, code);
  if (step == null) throw httpError('Mã không đúng. Kiểm tra giờ trên điện thoại và nhập mã đang hiện', 400);
  await Store.update('staff', { id: s.id }, { totp_secret: fresh.totp_pending, totp_pending: null, totp_enabled: true, totp_last_step: step });
  return publicStaff({ ...fresh, totp_enabled: true });
}
async function totpDisable(s, code) {
  const fresh = await Store.one('staff', { id: s.id });
  if (!fresh.totp_enabled) return publicStaff(fresh);
  if (TOTP.verify(TOTP.open(fresh.totp_secret, Auth.secret()), code) == null) throw httpError('Mã xác thực không đúng', 400);
  await Store.update('staff', { id: s.id }, { totp_enabled: false, totp_secret: null, totp_pending: null });
  return publicStaff({ ...fresh, totp_enabled: false });
}
// Quản lý đặt lại khi nhân viên mất điện thoại
async function totpReset(id) {
  const [row] = await Store.update('staff', { id }, { totp_enabled: false, totp_secret: null, totp_pending: null });
  if (!row) throw httpError('Không tìm thấy nhân viên', 404);
  return publicStaff(row);
}
const require2fa = () => process.env.STAFF_REQUIRE_2FA === '1';

async function changeOwnPassword(s, current_password, new_password) {
  if (!Auth.verifyPassword(current_password, s.password_hash)) throw httpError('Mật khẩu hiện tại không đúng', 400);
  validate({ password: new_password }, { partial: true });
  await Store.update('staff', { id: s.id }, { password_hash: Auth.hashPassword(new_password) });
}

// Nhật ký thao tác nội bộ: ai làm gì, lúc nào, trên đối tượng nào.
// Trả về true nếu đã ghi; false nếu ghi lỗi (đã log lỗi phía máy chủ để vận hành phát hiện).
async function audit(s, action, target, detail = {}) {
  try {
    await Store.insert('audit_logs', {
      staff_id: s ? s.id : null, staff_name: s ? s.full_name : 'Hệ thống', role: s ? s.role : null,
      action, target: target || null, detail
    });
    return true;
  } catch (e) {
    console.error('[audit] KHÔNG GHI ĐƯỢC NHẬT KÝ', JSON.stringify({ action, target: target || null, staff: s ? s.email : null, error: e.message }));
    return false;
  }
}

const count = async () => (await Store.find('staff', {}, { limit: 1 })).length;

// Chạy thử bằng bộ nhớ trong: tạo sẵn 4 tài khoản demo (mật khẩu beta-admin) cho 4 vai trò
let seeded = false;
async function seedDemo() {
  // Không bao giờ tạo tài khoản mẫu (mật khẩu ai cũng biết) trên web thật
  if (seeded || Store.isLive() || Store.dbMissing()) return;
  seeded = true;
  if (await count()) return;
  for (const [role, email, name] of [
    ['MANAGER', 'quanly@beta.local', 'Quản Lý Demo'], ['ACCOUNTANT', 'ketoan@beta.local', 'Kế Toán Demo'],
    ['CS', 'cskh@beta.local', 'CSKH Demo'], ['COUNTER', 'quay@beta.local', 'Quầy Demo']
  ]) await create({ email, full_name: name, role, password: 'beta-admin' });
}

module.exports = { totpSetup, totpEnable, totpDisable, totpReset, require2fa, ROLES, PERMS, can, create, login, current, guard, update, changeOwnPassword, audit, count, seedDemo, publicStaff };
