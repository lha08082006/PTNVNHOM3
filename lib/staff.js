// lib/staff.js - Tài khoản nhân viên nội bộ, phân quyền theo vai trò và nhật ký thao tác
//   MANAGER    : Quản lý – toàn quyền, quản lý nhân sự, xem nhật ký, công cụ IT
//   ACCOUNTANT : Kế toán – duyệt chi / trả về hồ sơ hoàn tiền, báo cáo đối soát
//   CS         : Nhân viên CSKH – phiếu hỗ trợ, đối chiếu & gửi hồ sơ hoàn tiền sang Kế toán
//   COUNTER    : Nhân viên quầy – tra cứu đơn / vé
const Store = require('./store');
const Auth = require('./auth');

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
  COUNTER: ['order.view']
};
const can = (staff, perm) => !!staff && (staff.role === 'MANAGER' || (PERMS[staff.role] || []).includes(perm));
const permsOf = (role) => role === 'MANAGER' ? ['*'] : (PERMS[role] || []);

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // phiên nhân viên: 12 giờ (1 ca làm)
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const normEmail = (s) => String(s || '').trim().toLowerCase();

const publicStaff = (s) => s && ({
  id: s.id, email: s.email, full_name: s.full_name, role: s.role, role_label: ROLES[s.role],
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

async function login(email, password) {
  const s = await Store.one('staff', { email: normEmail(email) });
  if (!s || !Auth.verifyPassword(password, s.password_hash)) throw httpError('Sai email hoặc mật khẩu', 401);
  if (s.active === false) throw httpError('Tài khoản đã bị khóa. Liên hệ Quản lý.', 403);
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

async function changeOwnPassword(s, current_password, new_password) {
  if (!Auth.verifyPassword(current_password, s.password_hash)) throw httpError('Mật khẩu hiện tại không đúng', 400);
  validate({ password: new_password }, { partial: true });
  await Store.update('staff', { id: s.id }, { password_hash: Auth.hashPassword(new_password) });
}

// Nhật ký thao tác nội bộ: ai làm gì, lúc nào, trên đối tượng nào
async function audit(s, action, target, detail = {}) {
  try {
    await Store.insert('audit_logs', {
      staff_id: s ? s.id : null, staff_name: s ? s.full_name : 'Hệ thống', role: s ? s.role : null,
      action, target: target || null, detail
    });
  } catch (e) { console.warn('[audit]', e.message); }
}

const count = async () => (await Store.find('staff', {}, { limit: 1 })).length;

// Chạy thử bằng bộ nhớ trong: tạo sẵn 4 tài khoản demo (mật khẩu beta-admin) cho 4 vai trò
let seeded = false;
async function seedDemo() {
  if (seeded || Store.isLive()) return;
  seeded = true;
  if (await count()) return;
  for (const [role, email, name] of [
    ['MANAGER', 'quanly@beta.local', 'Quản Lý Demo'], ['ACCOUNTANT', 'ketoan@beta.local', 'Kế Toán Demo'],
    ['CS', 'cskh@beta.local', 'CSKH Demo'], ['COUNTER', 'quay@beta.local', 'Quầy Demo']
  ]) await create({ email, full_name: name, role, password: 'beta-admin' });
}

module.exports = { ROLES, PERMS, can, create, login, current, guard, update, changeOwnPassword, audit, count, seedDemo, publicStaff };
