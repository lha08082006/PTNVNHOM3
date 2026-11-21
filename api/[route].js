// api/[route].js - Serverless Function DUY NHẤT trên Vercel cho mọi đường /api/<tên>.
// Gói Hobby giới hạn 12 function mỗi lần deploy; gom lại để không bị chặn deploy.
// Logic từng API nằm ở lib/routes/<tên>.js (xem lib/routes/index.js).
const { routeOf } = require('../lib/routes');
// Đợt 10: các API vẫn chạy khi web thật chưa nối database (chỉ đọc danh mục / kiểm tra sống chết)
const DB_FREE = new Set(['health', 'catalog', 'movie-page', 'sitemap']);

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const name = String(query.route || '');
  const route = routeOf(name);
  if (!route) return res.status(404).json({ ok: false, error: 'Không tìm thấy API /api/' + name });
  // Chặn gửi dồn dập theo IP (lib/ratelimit.js)
  const wait = require('../lib/ratelimit').check({ ...req, query }, name);
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ ok: false, error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ' + wait + ' giây' });
  }
  // Vercel đưa tham số động [route] vào req.query – bỏ ra để các handler chỉ thấy query string thật
  const { route: _omit, ...rest } = query;
  // Đợt 10: web thật chưa nối database -> khóa đăng ký, đặt vé, thanh toán, webhook (SePay sẽ gửi lại sau),
  // để không nhận tiền thật vào bộ nhớ tạm. Trang admin vẫn hỏi được trạng thái để hiện cảnh báo.
  if (require('../lib/store').dbMissing() && !DB_FREE.has(name) && !(name === 'admin' && rest.action === 'status')) {
    res.setHeader('Retry-After', '600');
    return res.status(503).json({ ok: false, code: 'DB_MISSING', error: 'Đặt vé online đang tạm ngưng để bảo trì. Vui lòng thử lại sau hoặc mua vé tại quầy.' });
  }
  req.query = rest;
  res.__route = name; // để ghi log lỗi biết API nào (lib/api-util.js fail)
  try {
    return await route(req, res);
  } catch (e) {
    // Lỗi không được handler bắt: ghi log + trả 500 gọn, không lộ chi tiết
    await require('../lib/ops').error('api:' + name, e);
    if (!res.writableEnded && !res.headersSent) return res.status(500).json({ ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít phút' });
  }
};
