// lib/routes/health.js (phục vụ tại /api/health) - Kiểm tra sống / chết cho dịch vụ giám sát bên ngoài
// (UptimeRobot, Better Stack…). Công khai, không lộ chi tiết: chỉ báo máy chủ và database có trả lời không.
//   200 { ok: true, db: 'ok' }      mọi thứ bình thường
//   503 { ok: false, db: 'error' }  database không trả lời -> dịch vụ giám sát báo động
const Store = require('../store');

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  let db = 'ok';
  try { await Store.find('cinemas', {}, { order: null, limit: 1 }); } catch (e) { db = 'error'; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(db === 'ok' ? 200 : 503).json({ ok: db === 'ok', db, ms: Date.now() - t0, time: new Date().toISOString() });
};
