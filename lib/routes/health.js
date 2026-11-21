// lib/routes/health.js (phục vụ tại /api/health) - Kiểm tra sống / chết cho dịch vụ giám sát bên ngoài
// (UptimeRobot, Better Stack…). Công khai, không lộ chi tiết: chỉ báo máy chủ và database có trả lời không.
//   200 { ok: true, db: 'ok' }      mọi thứ bình thường
//   503 { ok: false, db: 'error' }  database không trả lời -> dịch vụ giám sát báo động
//   503 { ok: false, db: 'missing' } web thật chưa nối Supabase (Đợt 10) – đặt vé đang bị khóa
//   mode: 'live' (Supabase) | 'mock' (bộ nhớ trong, chỉ dùng khi chạy thử ở máy)
const Store = require('../store');

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  if (Store.dbMissing()) return res.status(503).json({ ok: false, db: 'missing', mode: 'missing', error: 'Chưa nối database: kiểm tra SUPABASE_URL và SUPABASE_SECRET_KEY trên Vercel rồi Redeploy', hints: Store.configDiag().hints, time: new Date().toISOString() });
  let db = 'ok';
  try { await Store.find('cinemas', {}, { order: null, limit: 1 }); } catch (e) { db = 'error'; }
  return res.status(db === 'ok' ? 200 : 503).json({ ok: db === 'ok', db, mode: Store.isLive() ? 'live' : 'mock', ms: Date.now() - t0, time: new Date().toISOString() });
};
