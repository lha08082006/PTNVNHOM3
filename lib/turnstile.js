// lib/turnstile.js - Cloudflare Turnstile (ô "Tôi không phải robot") cho các form công khai:
//   Gửi yêu cầu hỗ trợ (POST /api/support), Thuê rạp (POST /api/events),
//   Đăng ký (POST /api/auth?action=register), Quên mật khẩu (POST /api/auth?action=forgot).
// Chỉ bật khi đặt ĐỦ hai biến môi trường (tạo miễn phí ở dash.cloudflare.com > Turnstile > Add widget):
//   TURNSTILE_SITE_KEY   – khóa công khai: trình duyệt dùng để hiện ô xác minh
//   TURNSTILE_SECRET_KEY – khóa bí mật: máy chủ dùng để hỏi Cloudflare mã có hợp lệ không
// Chưa đặt -> bỏ qua hoàn toàn, form chạy như cũ (vẫn có giới hạn tần suất theo IP / tài khoản).
// Trình duyệt gửi mã qua header X-Turnstile-Token (turnstile.js tự gắn vào đúng yêu cầu POST).
// Mỗi form có "action" riêng: mã lấy ở form Đăng ký không dùng được cho form Hỗ trợ.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const httpError = (msg, http) => Object.assign(new Error(msg), { http });

function keys(env = process.env) {
  const site = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  return site && secret ? { site, secret } : null;
}
const siteKey = () => { const k = keys(); return k ? k.site : null; };

async function verify(req, action) {
  const k = keys();
  if (!k) return { skipped: true };
  const h = req.headers || {};
  const token = String(h['x-turnstile-token'] || (req.body && req.body.turnstile_token) || '').trim();
  if (!token || token.length > 2048) throw httpError('Vui lòng hoàn tất ô xác minh "Tôi không phải robot" rồi gửi lại.', 400);
  const form = new URLSearchParams({ secret: k.secret, response: token });
  const ip = require('./ratelimit').ipOf(req);
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  let j;
  try {
    const r = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: ctl.signal });
    j = await r.json();
  } catch (e) {
    // Cloudflare không trả lời (mạng / quá 5 giây): cho qua để khách không bị kẹt – vẫn còn giới hạn tần suất
    console.warn('[turnstile] không kiểm tra được với Cloudflare:', e.name === 'AbortError' ? 'quá 5 giây' : e.message);
    return { skipped: true, error: true };
  } finally { clearTimeout(timer); }
  if (!j || j.success !== true) throw httpError('Xác minh "Tôi không phải robot" không hợp lệ hoặc đã hết hạn. Vui lòng xác minh lại rồi gửi.', 400);
  if (action && j.action && j.action !== action) throw httpError('Xác minh "Tôi không phải robot" không khớp với biểu mẫu này. Vui lòng tải lại trang.', 400);
  return { ok: true };
}

module.exports = { verify, siteKey, keys, VERIFY_URL };
