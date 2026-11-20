// lib/ops.js - Vận hành (Đợt 5): ghi lỗi máy chủ, cảnh báo email cho Quản lý, tình trạng hệ thống, sao lưu
//
// - error(): lỗi 5xx / lỗi không bắt được -> bảng error_logs. Nhiều lỗi dồn dập (>= 5 trong 10 phút) -> cảnh báo.
// - mark(): ghi "lần chạy gần nhất" (cron, webhook…) vào system_state để trang IT biết hệ thống còn sống.
// - alert(): gửi email cho ALERT_EMAILS (cách nhau dấu phẩy) hoặc mọi tài khoản Quản lý đang hoạt động.
//   Mỗi loại cảnh báo gửi tối đa 1 lần / 60 phút để không spam hộp thư.
// - status(): số liệu cho thẻ "Tình trạng hệ thống" ở admin.html > IT.
// - backup(): toàn bộ dữ liệu các bảng (JSON) để Quản lý tải về lưu trữ.
// Mọi hàm ở đây KHÔNG được làm hỏng request đang chạy: lỗi khi ghi log chỉ in ra console.
const Store = require('./store');
const Mailer = require('./mailer');

const MIN = 60e3;
const iso = (d) => new Date(d).toISOString();
const ALERT_EVERY_MS = 60 * MIN;
const TABLES = ['customers', 'orders', 'seat_holds', 'bank_transactions', 'refunds', 'support_tickets', 'notifications', 'gateway_logs',
  'staff', 'audit_logs', 'movies', 'cinemas', 'rooms', 'showtimes', 'vouchers', 'ticket_checkins', 'ticket_types', 'price_rules', 'holidays', 'posts',
  'point_ledger', 'movie_reviews', 'event_requests', 'movie_watches', 'payment_attempts', 'invoice_requests', 'favorites', 'error_logs', 'system_state', 'campaigns', 'day_closings'];

async function getState(id) { try { return await Store.one('system_state', { id }); } catch (e) { return null; } }
async function setState(id, value) {
  const row = { value: value || {}, updated_at: iso(Date.now()) };
  try {
    const [u] = await Store.update('system_state', { id }, row);
    if (!u) await Store.insert('system_state', { id, ...row });
  } catch (e) { console.warn('[ops.state]', id, e.message); }
}
const mark = (key, info) => setState('last:' + key, info);

async function recipients() {
  const env = String(process.env.ALERT_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.length) return env;
  try { return (await Store.find('staff', { role: 'MANAGER' }, { order: null, limit: 20 })).filter(s => s.active !== false).map(s => s.email); }
  catch (e) { return []; }
}

async function alert(key, title, message) {
  try {
    const st = await getState('alert:' + key);
    if (st && Date.now() - new Date(st.updated_at).getTime() < ALERT_EVERY_MS) return { skipped: true };
    await setState('alert:' + key, { title, message });
    const to = await recipients();
    for (const email of to) await Mailer.send({ to: email, title: '[Cảnh báo hệ thống] ' + title, message }).catch(() => null);
    await Store.insert('notifications', { order_code: 'ALERT', channel: 'EMAIL', event: 'ALERT:' + key, title, message, recipient: to.join(', ') || '(chưa có người nhận)' }).catch(() => null);
    console.warn('[ALERT]', key, title);
    return { sent: to.length };
  } catch (e) { console.warn('[ops.alert]', e.message); return { error: e.message }; }
}

async function error(source, err, meta = {}) {
  const msg = String((err && err.message) || err || 'Lỗi không rõ').slice(0, 1000);
  console.error('[' + source + ']', msg);
  try {
    await Store.insert('error_logs', { source: String(source || '?').slice(0, 60), message: msg, stack: err && err.stack ? String(err.stack).slice(0, 4000) : null, meta });
    const recent = await Store.find('error_logs', { created_at: { gte: iso(Date.now() - 10 * MIN) } }, { order: null, limit: 50 });
    if (recent.length >= 5) await alert('error-burst', 'Máy chủ lỗi dồn dập', `${recent.length} lỗi trong 10 phút gần nhất. Lỗi mới nhất (${source}): ${msg}. Xem admin.html > IT / Dev.`);
  } catch (e) { console.warn('[ops.error]', e.message); }
}

// Webhook bị từ chối (sai / thiếu khóa): 3 lần trong 1 giờ -> cảnh báo
async function webhookRejected(provider, why) {
  await error('webhook:' + provider, new Error(why));
  try {
    const n = (await Store.find('error_logs', { source: 'webhook:' + provider, created_at: { gte: iso(Date.now() - 60 * MIN) } }, { order: null, limit: 20 })).length;
    if (n >= 3) await alert('webhook-' + provider, 'Webhook ' + provider + ' bị từ chối liên tục', `${n} lần trong 1 giờ (${why}). Tiền khách chuyển sẽ không tự xuất vé – kiểm tra khóa webhook trên ${provider} và biến môi trường.`);
  } catch (e) { /* bỏ qua */ }
}

// Kiểm tra hằng ngày (gọi từ cron)
async function dailyChecks(now = new Date()) {
  const out = {};
  try {
    const stuck = (await Store.find('refunds', { status: 'MANUAL_REVIEW' }, { order: null, limit: 1000 })).filter(r => now - new Date(r.created_at) > 24 * 60 * MIN);
    out.manual_overdue = stuck.length;
    if (stuck.length) await alert('manual-overdue', stuck.length + ' hồ sơ hoàn tiền thủ công quá 24 giờ', 'Các hồ sơ: ' + stuck.slice(0, 15).map(r => r.code).join(', ') + '. Vào admin.html > CSKH, bộ lọc "Cần xử lý".');
  } catch (e) { out.error = e.message; }
  return out;
}

async function status(now = new Date()) {
  const ago = (ms) => iso(now.getTime() - ms);
  const [cron, webhook, errs, manual, tickets, pending] = await Promise.all([
    getState('last:cron'), getState('last:webhook'),
    Store.find('error_logs', { created_at: { gte: ago(24 * 60 * MIN) } }, { limit: 200 }).catch(() => []),
    Store.find('refunds', { status: 'MANUAL_REVIEW' }, { order: null, limit: 1000 }).catch(() => []),
    Store.find('support_tickets', { status: { neq: 'RESOLVED' } }, { order: null, limit: 5000 }).catch(() => []),
    Store.find('orders', { status: { in: ['PENDING', 'EXPIRED'] } }, { order: null, limit: 5000 }).catch(() => [])
  ]);
  const alerts = await Store.find('notifications', { order_code: 'ALERT' }, { limit: 10 }).catch(() => []);
  return {
    db: Store.isLive() ? 'Supabase' : 'Bộ nhớ trong (thử nghiệm)',
    mail: process.env.RESEND_API_KEY ? 'Đã cấu hình' : 'Chưa cấu hình (không gửi email thật)',
    alert_to: (await recipients()).length,
    last_cron: cron ? cron.updated_at : null, last_cron_info: cron ? cron.value : null,
    last_webhook: webhook ? webhook.updated_at : null,
    errors_24h: errs.length,
    last_errors: errs.slice(0, 10).map(e => ({ at: e.created_at, source: e.source, message: e.message })),
    manual_refunds: manual.length, open_tickets: tickets.length, waiting_orders: pending.length,
    recent_alerts: alerts.map(a => ({ at: a.created_at, title: a.title, message: a.message }))
  };
}

async function backup() {
  const data = {};
  for (const t of TABLES) {
    try { data[t] = await Store.findAll(t); } catch (e) { data[t] = { error: e.message }; }
  }
  return { app: 'beta-cinemas', created_at: iso(Date.now()), source: Store.isLive() ? 'supabase' : 'mock', tables: data };
}

module.exports = { error, alert, mark, webhookRejected, dailyChecks, status, backup, TABLES };
