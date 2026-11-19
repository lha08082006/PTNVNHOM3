// lib/routes/index.js - Bảng định tuyến API dùng chung cho Vercel (api/[route].js) và server local (server.js).
// Gói Hobby của Vercel chỉ cho tối đa 12 Serverless Function mỗi lần deploy, nên toàn bộ API
// được gom vào MỘT function: /api/<tên> → ROUTES[<tên>]. Thêm API mới: tạo lib/routes/<tên>.js rồi khai báo ở đây.
const ROUTES = {
  'auth': require('./auth'),
  'catalog': require('./catalog'),
  'orders': require('./orders'),
  'create-order': require('./create-order'),
  'order-status': require('./order-status'),
  'order-action': require('./order-action'),
  'sepay-webhook': require('./sepay-webhook'),
  'reconcile': require('./reconcile'),
  'refund': require('./refund'),
  'report-issue': require('./report-issue'),
  'support': require('./support'),
  'seats': require('./seats'),
  'cron': require('./cron'),
  'admin': require('./admin'),
  'simulate-payment': require('./simulate-payment'),
  'sitemap': require('./sitemap')
};

const routeOf = (name) => (Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null);

module.exports = { ROUTES, routeOf };
