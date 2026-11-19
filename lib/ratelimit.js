// lib/ratelimit.js - Chặn spam API theo địa chỉ IP (Đợt 5)
// Cửa sổ trượt 60 giây, đếm trong bộ nhớ của tiến trình. Trên Vercel mỗi phiên bản function có bộ nhớ
// riêng nên đây là lớp chặn "mềm" (chặn script gửi dồn dập vào cùng một phiên bản); các chỗ nhạy cảm
// đã có chặn theo tài khoản / SĐT lưu trong database (lib/throttle.js: đăng nhập, quên mật khẩu, thuê rạp…).
//   GET  : 240 lần / phút / IP
//   POST : 30 lần / phút / IP / mỗi API
// Không áp cho webhook / IPN của cổng thanh toán, cron và /api/health.
const WINDOW_MS = 60e3;
const LIMITS = { GET: 240, POST: 30 };
const EXEMPT = new Set(['sepay-webhook', 'cron', 'health']);
const hits = new Map(); // key -> [thời điểm]

function ipOf(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
}

// Trả về null nếu được phép, hoặc số giây phải chờ
function check(req, route, now = Date.now()) {
  if (EXEMPT.has(route)) return null;
  if (route === 'pay' && req.query && /^(ipn|return)$/.test(req.query.action)) return null;
  const method = req.method === 'GET' || req.method === 'HEAD' ? 'GET' : 'POST';
  const key = ipOf(req) + '|' + method + (method === 'POST' ? '|' + route : '');
  const list = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= LIMITS[method]) {
    hits.set(key, list);
    return Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000));
  }
  list.push(now);
  hits.set(key, list);
  // Dọn bớt khi bảng quá lớn
  if (hits.size > 20000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  return null;
}

module.exports = { check, LIMITS, _hits: hits };
