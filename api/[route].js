// api/[route].js - Serverless Function DUY NHẤT trên Vercel cho mọi đường /api/<tên>.
// Gói Hobby giới hạn 12 function mỗi lần deploy; gom lại để không bị chặn deploy.
// Logic từng API nằm ở lib/routes/<tên>.js (xem lib/routes/index.js).
const { routeOf } = require('../lib/routes');

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const name = String(query.route || '');
  const route = routeOf(name);
  if (!route) return res.status(404).json({ ok: false, error: 'Không tìm thấy API /api/' + name });
  // Vercel đưa tham số động [route] vào req.query – bỏ ra để các handler chỉ thấy query string thật
  const { route: _omit, ...rest } = query;
  req.query = rest;
  return route(req, res);
};
