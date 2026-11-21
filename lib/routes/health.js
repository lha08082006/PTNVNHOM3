// lib/routes/health.js (phục vụ tại /api/health) - Kiểm tra sống / chết cho dịch vụ giám sát bên ngoài
// (UptimeRobot, Better Stack…). Công khai, không lộ chi tiết: chỉ báo máy chủ và database có trả lời không.
//   200 { ok: true, db: 'ok' }      mọi thứ bình thường
//   503 { ok: false, db: 'error' }  database không trả lời -> dịch vụ giám sát báo động
//   503 { ok: false, db: 'missing' } web thật chưa nối Supabase (Đợt 10) – đặt vé đang bị khóa
//   mode: 'live' (Supabase) | 'mock' (bộ nhớ trong, chỉ dùng khi chạy thử ở máy)
//   ?schema=1 (Đợt 10d): kèm schema { ok, missing:[{file, items}] } – migration nào chưa chạy (chỉ tên bảng / cột)
//              (Đợt 10h) và payments { ok, webhook_url, last_webhook, sepay_api… } – cấu hình chuyển khoản SePay
const Store = require('../store');
const Schema = require('../schema-check');

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  if (Store.dbMissing()) return res.status(503).json({ ok: false, db: 'missing', mode: 'missing', error: 'Chưa nối database: kiểm tra SUPABASE_URL và SUPABASE_SECRET_KEY trên Vercel rồi Redeploy', hints: Store.configDiag().hints, deploy: Store.configDiag().deploy, time: new Date().toISOString() });
  let db = 'ok';
  try { await Store.find('cinemas', {}, { order: null, limit: 1 }); } catch (e) { db = 'error'; }
  const out = { ok: db === 'ok', db, mode: Store.isLive() ? 'live' : 'mock', ms: Date.now() - t0, time: new Date().toISOString() };
  const q = req.query || {};
  if (q.schema === '1' && db === 'ok') {
    try { out.schema = await Schema.check({ fresh: true }); } catch (e) { out.schema = { ok: false, error: 'Không kiểm tra được cấu trúc database' }; }
    // Đợt 10h: chẩn đoán thanh toán chuyển khoản SePay (khóa, API, webhook gần nhất, địa chỉ webhook cần khai báo)
    try { out.payments = await require('../pay-diag').check(req); } catch (e) { out.payments = { ok: false, error: 'Không kiểm tra được cấu hình thanh toán' }; }
  }
  return res.status(db === 'ok' ? 200 : 503).json(out);
};
