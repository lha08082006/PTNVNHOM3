// lib/totp.js - Mã 6 số đổi mỗi 30 giây (TOTP, RFC 6238) cho đăng nhập 2 lớp của nhân viên (Đợt 6)
// Dùng được với Google Authenticator, Microsoft Authenticator, Authy… Không cần thư viện ngoài.
// Khóa bí mật lưu trong database ở dạng MÃ HÓA (AES-256-GCM, khóa suy ra từ AUTH_SECRET).
const crypto = require('crypto');

const STEP = 30, DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

function codeAt(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}
const counterNow = (now = Date.now()) => Math.floor(now / 1000 / STEP);

// Trả về bước thời gian khớp (để chống dùng lại mã), hoặc null. Cho lệch ±1 bước (đồng hồ điện thoại sai vài giây).
function verify(secretB32, code, now = Date.now(), window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const t = counterNow(now);
  for (let d = -window; d <= window; d++) {
    const want = Buffer.from(codeAt(secretB32, t + d)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got)) return t + d;
  }
  return null;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const otpauthUrl = (secretB32, account, issuer = 'Beta Cinemas Admin') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

// Mã hóa khóa bí mật trước khi lưu
const keyOf = (authSecret) => crypto.createHash('sha256').update(String(authSecret) + ':totp').digest();
function seal(secretB32, authSecret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(authSecret), iv);
  const enc = Buffer.concat([c.update(secretB32, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}
function open(sealed, authSecret) {
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(authSecret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

module.exports = { base32Encode, base32Decode, codeAt, counterNow, verify, newSecret, otpauthUrl, seal, open };
