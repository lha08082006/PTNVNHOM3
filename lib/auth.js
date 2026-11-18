// lib/auth.js - Tài khoản thành viên Beta Club: băm mật khẩu (scrypt) + phiên đăng nhập (token ký HMAC)
// Không phụ thuộc Supabase Auth để chạy được cả ở chế độ bộ nhớ trong (DB_MODE=mock) lẫn Supabase.
const crypto = require('crypto');
const Store = require('./store');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
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
  id: c.id, email: c.email, phone: c.phone, full_name: c.full_name, birthday: c.birthday || null, created_at: c.created_at
});

const normEmail = (s) => String(s || '').trim().toLowerCase();
const normPhone = (s) => String(s || '').replace(/[\s.-]/g, '');
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s) => /^(0|\+84)\d{9,10}$/.test(s);

async function register({ full_name, email, phone, password, birthday }) {
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
    c = await Store.insert('customers', { email: em, phone: ph, full_name: name, birthday: bday, password_hash: hashPassword(password) });
  } catch (e) {
    if (e.code === '23505') throw httpError('Email hoặc số điện thoại đã được đăng ký', 409);
    throw e;
  }
  return { token: issueToken(c), user: publicCustomer(c) };
}

async function login({ login: id, password }) {
  const raw = String(id || '').trim();
  const c = isEmail(normEmail(raw))
    ? await Store.one('customers', { email: normEmail(raw) })
    : await Store.one('customers', { phone: normPhone(raw) });
  // Cùng một thông báo cho "không có tài khoản" và "sai mật khẩu" để không lộ tài khoản nào tồn tại
  if (!c || !verifyPassword(password, c.password_hash)) throw httpError('Sai email/số điện thoại hoặc mật khẩu', 401);
  return { token: issueToken(c), user: publicCustomer(c) };
}

// Đọc thành viên từ header "Authorization: Bearer <token>". Trả null nếu chưa đăng nhập.
async function currentCustomer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const p = m && verifyToken(m[1]);
  if (!p) return null;
  if (p.typ && p.typ !== 'customer') return null; // token nhân viên không dùng làm phiên khách
  const c = await Store.one('customers', { id: p.sub });
  return c && p.v === pwVersion(c) ? c : null;
}

async function updateProfile(c, { full_name, phone, birthday }) {
  const patch = {};
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

module.exports = { register, login, currentCustomer, updateProfile, changePassword, publicCustomer, verifyToken, hashPassword, verifyPassword, sign, pwVersion };
