// lib/auth.js - Tài khoản thành viên Beta Club: băm mật khẩu (scrypt) + phiên đăng nhập (token ký HMAC)
// Không phụ thuộc Supabase Auth để chạy được cả ở chế độ bộ nhớ trong (DB_MODE=mock) lẫn Supabase.
const crypto = require('crypto');
const Store = require('./store');
const Throttle = require('./throttle');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
// Phiên bản điều khoản / chính sách bảo mật hiện hành – đổi khi sửa policy.html để biết khách đã đồng ý bản nào
const TERMS_VERSION = '2026-11';
const MIN_PASSWORD = 8;

function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  // Chỉ cho phép khóa mặc định khi chạy bộ nhớ trong; dùng Supabase thật thì bắt buộc đặt AUTH_SECRET.
  return Store.isLive() ? null : 'beta-dev-auth-secret';
}

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${b64u(salt)}$${b64u(hash)}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

function sign(payload) {
  const key = secret();
  if (!key) throw httpError('Chưa cấu hình AUTH_SECRET trên máy chủ', 503);
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', key).update(body).digest());
  return `${body}.${mac}`;
}

function verifyToken(token) {
  const key = secret();
  if (!key || !token) return null;
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.sub || !(p.exp > Date.now())) return null;
    return p;
  } catch (e) {
    return null;
  }
}

// "v" gắn token với mật khẩu hiện tại: đổi mật khẩu thì mọi phiên cũ tự hết hiệu lực
const pwVersion = (c) => String(c.password_hash || '').split('$')[1].slice(0, 10);
const issueToken = (customer) => sign({ sub: customer.id, v: pwVersion(customer), exp: Date.now() + TOKEN_TTL_MS });

// Thông tin công khai của thành viên (không bao giờ trả password_hash ra ngoài)
const publicCustomer = (c) => c && ({
  id: c.id, email: c.email, phone: c.phone, full_name: c.full_name, birthday: c.birthday || null, created_at: c.created_at,
  marketing_opt_in: !!c.marketing_opt_in, terms_version: c.terms_version || null, terms_accepted_at: c.terms_accepted_at || null
});

const normEmail = (s) => String(s || '').trim().toLowerCase();
const normPhone = (s) => String(s || '').replace(/[\s.-]/g, '');
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s) => /^(0|\+84)\d{9,10}$/.test(s);

async function register({ full_name, email, phone, password, birthday, accept_terms, marketing_opt_in }) {
  // NĐ 13/2023: phải có sự đồng ý rõ ràng trước khi xử lý dữ liệu cá nhân -> lưu thời điểm + phiên bản điều khoản
  if (accept_terms !== true) throw httpError('Vui lòng đồng ý điều khoản sử dụng và chính sách bảo mật', 400);
  const name = String(full_name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const em = normEmail(email);
  const ph = normPhone(phone);
  if (name.length < 2) throw httpError('Vui lòng nhập họ tên', 400);
  if (!isEmail(em)) throw httpError('Email không hợp lệ', 400);
  if (!isPhone(ph)) throw httpError('Số điện thoại không hợp lệ (VD: 0987654321)', 400);
  if (String(password || '').length < MIN_PASSWORD) throw httpError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`, 400);
  const bday = /^\d{4}-\d{2}-\d{2}$/.test(String(birthday || '')) ? birthday : null;

  if (await Store.one('customers', { email: em })) throw httpError('Email này đã được đăng ký', 409);
  if (await Store.one('customers', { phone: ph })) throw httpError('Số điện thoại này đã được đăng ký', 409);
  let c;
  try {
    const now = new Date().toISOString();
    c = await Store.insert('customers', {
      email: em, phone: ph, full_name: name, birthday: bday, password_hash: hashPassword(password),
      terms_version: TERMS_VERSION, terms_accepted_at: now,
      marketing_opt_in: marketing_opt_in === true, marketing_opt_in_at: marketing_opt_in === true ? now : null
    });
  } catch (e) {
    if (e.code === '23505') throw httpError('Email hoặc số điện thoại đã được đăng ký', 409);
    throw e;
  }
  return { token: issueToken(c), user: publicCustomer(c) };
}

async function login({ login: id, password }) {
  const raw = String(id || '').trim();
  const c0 = isEmail(normEmail(raw))
    ? await Store.one('customers', { email: normEmail(raw) })
    : await Store.one('customers', { phone: normPhone(raw) });
  const c = c0 && !c0.deleted_at ? c0 : null;
  // Cùng một thông báo cho "không có tài khoản" và "sai mật khẩu" để không lộ tài khoản nào tồn tại
  const tkey = 'c:' + (isEmail(normEmail(raw)) ? normEmail(raw) : normPhone(raw));
  await Throttle.check(tkey);
  if (!c || !verifyPassword(password, c.password_hash)) {
    const n = await Throttle.fail(tkey);
    throw httpError('Sai email/số điện thoại hoặc mật khẩu' + (n >= 3 && n < 5 ? ` (còn ${5 - n} lần thử trước khi bị khóa 15 phút)` : ''), 401);
  }
  await Throttle.reset(tkey);
  return { token: issueToken(c), user: publicCustomer(c) };
}

// ---------------------------------------------------------------------------
// Quên mật khẩu: gửi mã 6 số qua email (hết hạn 15 phút, tối đa 5 lần nhập sai)
// ---------------------------------------------------------------------------
const RESET_TTL_MS = 15 * 60 * 1000;
const codeHash = (code) => crypto.createHmac('sha256', secret() || 'x').update('reset:' + code).digest('hex');

async function forgotPassword(email) {
  const em = normEmail(email);
  if (!isEmail(em)) throw httpError('Email không hợp lệ', 400);
  await Throttle.check('f:' + em);
  await Throttle.fail('f:' + em, 3); // tối đa 3 lần yêu cầu mã / 15 phút
  const c = await Store.one('customers', { email: em });
  const out = { ok: true, message: 'Nếu email đã đăng ký, mã đặt lại mật khẩu sẽ được gửi trong ít phút.' };
  if (!c) return out; // không tiết lộ email nào có tài khoản
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await Store.update('password_resets', { customer_id: c.id, used: false }, { used: true }); // mã cũ hết hiệu lực
  await Store.insert('password_resets', { customer_id: c.id, code_hash: codeHash(code), expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(), attempts: 0, used: false });
  const Mailer = require('./mailer');
  const sent = await Mailer.send({ to: c.email, title: 'Mã đặt lại mật khẩu', message: `Mã đặt lại mật khẩu Beta Cinemas của bạn là ${code}. Mã có hiệu lực 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.` });
  if (!sent.sent) {
    console.warn('[forgot] Không gửi được email đặt lại mật khẩu:', sent.reason);
    if (!Store.isLive()) out.dev_code = code; // chỉ khi chạy thử bằng bộ nhớ trong
  }
  return out;
}

async function resetPassword({ email, code, new_password }) {
  const em = normEmail(email);
  await Throttle.check('r:' + em);
  if (String(new_password || '').length < MIN_PASSWORD) throw httpError(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`, 400);
  const c = await Store.one('customers', { email: em });
  const bad = async () => { await Throttle.fail('r:' + em); return httpError('Mã không đúng hoặc đã hết hạn', 400); };
  if (!c) throw await bad();
  const r = await Store.one('password_resets', { customer_id: c.id, used: false });
  if (!r || new Date(r.expires_at) < new Date() || r.attempts >= 5) throw await bad();
  const want = Buffer.from(r.code_hash), got = Buffer.from(codeHash(String(code || '').trim()));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    await Store.update('password_resets', { id: r.id }, { attempts: (r.attempts || 0) + 1 });
    throw await bad();
  }
  const password_hash = hashPassword(new_password); // đổi mật khẩu = mọi phiên cũ hết hiệu lực
  await Store.update('customers', { id: c.id }, { password_hash });
  await Store.update('password_resets', { id: r.id }, { used: true });
  await Throttle.reset('r:' + em);
  await Throttle.reset('c:' + em);
  const fresh = { ...c, password_hash };
  return { token: issueToken(fresh), user: publicCustomer(fresh) };
}

// Đọc thành viên từ header "Authorization: Bearer <token>". Trả null nếu chưa đăng nhập.
async function currentCustomer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const p = m && verifyToken(m[1]);
  if (!p) return null;
  if (p.typ && p.typ !== 'customer') return null; // token nhân viên không dùng làm phiên khách
  const c = await Store.one('customers', { id: p.sub });
  return c && !c.deleted_at && p.v === pwVersion(c) ? c : null;
}

async function updateProfile(c, { full_name, phone, birthday, marketing_opt_in }) {
  const patch = {};
  if (marketing_opt_in !== undefined) { patch.marketing_opt_in = marketing_opt_in === true; patch.marketing_opt_in_at = new Date().toISOString(); }
  if (full_name !== undefined) {
    const name = String(full_name).trim().replace(/\s+/g, ' ').slice(0, 80);
    if (name.length < 2) throw httpError('Vui lòng nhập họ tên', 400);
    patch.full_name = name;
  }
  if (phone !== undefined) {
    const ph = normPhone(phone);
    if (!isPhone(ph)) throw httpError('Số điện thoại không hợp lệ', 400);
    const other = await Store.one('customers', { phone: ph });
    if (other && other.id !== c.id) throw httpError('Số điện thoại này đã được đăng ký', 409);
    patch.phone = ph;
  }
  if (birthday !== undefined) patch.birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(birthday)) ? birthday : null;
  const [row] = await Store.update('customers', { id: c.id }, patch);
  return publicCustomer(row || { ...c, ...patch });
}

async function changePassword(c, { current_password, new_password }) {
  if (!verifyPassword(current_password, c.password_hash)) throw httpError('Mật khẩu hiện tại không đúng', 400);
  if (String(new_password || '').length < MIN_PASSWORD) throw httpError(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`, 400);
  const password_hash = hashPassword(new_password);
  await Store.update('customers', { id: c.id }, { password_hash });
  return { token: issueToken({ ...c, password_hash }) };
}

// ---------------------------------------------------------------------------
// Quyền của chủ thể dữ liệu (NĐ 13/2023): tải dữ liệu của mình, xóa tài khoản, hủy nhận email quảng cáo
// ---------------------------------------------------------------------------
async function exportData(c) {
  const mine = (t, f) => Store.find(t, f, { limit: 5000 }).catch(() => []);
  const strip = (rows, keys) => rows.map(r => { const o = { ...r }; keys.forEach(k => delete o[k]); return o; });
  const orders = await mine('orders', { user_id: c.id });
  return {
    exported_at: new Date().toISOString(),
    note: 'Dữ liệu cá nhân Beta Cinemas lưu về bạn. Liên hệ hotline 1900 636 807 nếu cần sửa hoặc có thắc mắc.',
    profile: publicCustomer(c),
    orders: strip(orders, ['sandbox', 'check_seq', 'last_check_at', 'job_checked_at']),
    points: await mine('point_ledger', { customer_id: c.id }),
    reviews: await mine('movie_reviews', { customer_id: c.id }),
    favorites: await mine('favorites', { customer_id: c.id }),
    movie_watches: await mine('movie_watches', { customer_id: c.id }),
    support_tickets: strip(await mine('support_tickets', { customer_id: c.id }), ['note', 'decision']),
    event_requests: strip(await mine('event_requests', { customer_id: c.id }), ['staff_note']),
    invoice_requests: await mine('invoice_requests', { customer_id: c.id })
  };
}

// Xóa tài khoản: xóa dữ liệu không bắt buộc lưu; đơn hàng / hóa đơn phải lưu theo luật kế toán nên chỉ ẨN DANH
// (bỏ tên, email, SĐT), giữ số tiền. Không cho xóa khi còn đơn đang chờ thanh toán / đang hoàn tiền.
async function deleteAccount(c, { password, confirm }) {
  if (!verifyPassword(password, c.password_hash)) throw httpError('Mật khẩu không đúng', 400);
  if (String(confirm || '').trim().toUpperCase() !== 'XOA') throw httpError('Gõ XOA để xác nhận xóa tài khoản', 400);
  const busy = await Store.find('orders', { user_id: c.id, status: { in: ['PENDING', 'EXPIRED', 'REFUND_REQUESTED', 'MANUAL_REVIEW'] } }, { limit: 5 });
  if (busy.length) throw httpError('Còn đơn đang chờ thanh toán hoặc đang hoàn tiền (' + busy.map(o => o.code).join(', ') + '). Vui lòng đợi xử lý xong rồi xóa tài khoản.', 409);
  const now = new Date().toISOString();
  for (const t of ['favorites', 'movie_watches', 'movie_reviews', 'point_ledger']) await Store.remove(t, { customer_id: c.id }).catch(() => null);
  await Store.update('orders', { user_id: c.id }, { customer_name: null, email: null, phone: null });
  await Store.update('support_tickets', { customer_id: c.id }, { customer_id: null });
  await Store.update('event_requests', { customer_id: c.id }, { customer_id: null });
  await Store.update('customers', { id: c.id }, {
    email: 'deleted+' + c.id + '@deleted.local', phone: null, full_name: 'Tài khoản đã xóa', birthday: null,
    password_hash: hashPassword(crypto.randomBytes(24).toString('hex')), // mọi phiên đăng nhập hết hiệu lực
    marketing_opt_in: false, deleted_at: now
  });
  return { ok: true, deleted_at: now };
}

// Link hủy nhận email quảng cáo trong thư (không cần đăng nhập): u = id khách, t = chữ ký HMAC
const unsubToken = (id) => crypto.createHmac('sha256', secret() || 'x').update('unsub:' + id).digest('base64url').slice(0, 24);
async function unsubscribe(id, t) {
  const want = Buffer.from(unsubToken(String(id || ''))), got = Buffer.from(String(t || ''));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw httpError('Link hủy đăng ký không hợp lệ', 400);
  await Store.update('customers', { id: String(id) }, { marketing_opt_in: false, marketing_opt_in_at: new Date().toISOString() });
  return { ok: true };
}

module.exports = { TERMS_VERSION, exportData, deleteAccount, unsubscribe, unsubToken, register, login, forgotPassword, resetPassword, currentCustomer, updateProfile, changePassword, publicCustomer, verifyToken, hashPassword, verifyPassword, sign, pwVersion, secret };
