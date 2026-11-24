// lib/pay-diag.js - Đợt 10h: tự chẩn đoán thanh toán chuyển khoản SePay (hiện trong /api/health?schema=1).
// Trả lời: đã đặt đủ khóa chưa, API SePay có trả lời không, webhook gần nhất về lúc nào / bị từ chối vì sao,
// và địa chỉ webhook cần khai báo bên SePay. Chỉ có đúng/sai, mã HTTP, thời điểm, kết quả – không có khóa,
// số tiền hay mã đơn.
const Store = require('./store');

const TTL = 60 * 1000;
let apiCache = null;

async function pingSepay() {
  const key = process.env.SEPAY_API_KEY;
  if (!key) return null;
  if (apiCache && Date.now() - apiCache.at < TTL) return apiCache.value;
  const qs = new URLSearchParams({ limit: '20' });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  let value;
  try {
    const r = await fetch('https://my.sepay.vn/userapi/transactions/list?' + qs, { headers: { Authorization: 'Bearer ' + String(key).trim() }, signal: ctrl.signal });
    value = { ok: r.ok, http: r.status };
    if (r.ok) {
      // Chỉ đếm, không trả dữ liệu giao dịch: có thấy giao dịch gần đây không, có giao dịch nào mang mã đơn,
      // và số tài khoản khai báo (SEPAY_ACCOUNT_NUMBER) có khớp tài khoản chính / tài khoản ảo nào không
      const j = await r.json().catch(() => ({}));
      const txs = Array.isArray(j.transactions) ? j.transactions : [];
      const acc = String(process.env.SEPAY_ACCOUNT_NUMBER || '').trim();
      const { extractOrderCode } = require('./gateway');
      value.recent = txs.length;
      value.recent_with_order_code = txs.filter(t => extractOrderCode(t.transaction_content)).length;
      if (acc && txs.length) value.account_seen = txs.some(t => String(t.account_number || '') === acc || String(t.sub_account || '') === acc);
    }
    if (r.status === 401 || r.status === 403) value.hint = 'SePay từ chối SEPAY_API_KEY – tạo lại API Token ở my.sepay.vn > Cấu hình công ty > API Access rồi dán vào Vercel';
  } catch (e) {
    value = { ok: false, http: null, hint: 'Không gọi được API SePay (' + String(e.name === 'AbortError' ? 'quá 5 giây' : e.message).slice(0, 80) + ')' };
  } finally { clearTimeout(t); }
  apiCache = { at: Date.now(), value };
  return value;
}

function siteOf(req) {
  const env = require('./site-url').envSiteUrl();
  const h = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  const here = h ? ((req.headers['x-forwarded-proto'] || 'https') + '://' + h) : env;
  return { here, site_url: env || null, site_url_matches: !env || !h || env === here };
}

async function check(req) {
  const e = process.env;
  const out = {
    webhook_key: !!e.SEPAY_WEBHOOK_KEY, api_key: !!e.SEPAY_API_KEY, account: !!e.SEPAY_ACCOUNT_NUMBER,
    bank: e.SEPAY_BANK_CODE ? String(e.SEPAY_BANK_CODE).trim().slice(0, 20) : null
  };
  const s = siteOf(req);
  out.webhook_url = s.here ? s.here + '/api/sepay-webhook' : null;
  if (!s.site_url_matches) out.site_url_note = 'Link trong email / IPN đang dùng ' + s.site_url + ' – khác địa chỉ đang chạy';
  try {
    const last = await Store.one('system_state', { id: 'last:webhook' });
    out.last_webhook = last ? { at: last.updated_at, result: (last.value && last.value.result) || null } : null;
  } catch (err) { out.last_webhook = null; }
  try {
    const rej = (await Store.find('error_logs', { source: 'webhook:SePay' }, { order: 'created_at', limit: 1 }))[0];
    out.last_rejected = rej ? { at: rej.created_at, reason: String(rej.message || '').slice(0, 100) } : null;
  } catch (err) { out.last_rejected = null; }
  out.sepay_api = await pingSepay();
  const hints = [];
  if (!out.webhook_key) hints.push('Thiếu SEPAY_WEBHOOK_KEY trên Vercel – webhook sẽ bị từ chối');
  if (!out.api_key) hints.push('Thiếu SEPAY_API_KEY – không có đường dự phòng khi webhook không về');
  if (out.sepay_api && out.sepay_api.hint) hints.push(out.sepay_api.hint);
  if (out.sepay_api && out.sepay_api.recent_with_order_code > 0 && !out.last_webhook && !out.last_rejected) {
    hints.push('SePay có giao dịch mang mã đơn nhưng web chưa nhận được webhook nào – kiểm tra webhook bên SePay: URL ' + (out.webhook_url || '<tên-miền>/api/sepay-webhook') + ', tab Bảo mật chọn API Key trùng SEPAY_WEBHOOK_KEY');
  }
  if (out.last_rejected && (!out.last_webhook || new Date(out.last_rejected.at) > new Date(out.last_webhook.at))) {
    hints.push('Webhook gần nhất bị từ chối: ' + out.last_rejected.reason + ' – kiểm tra "API Key" trong cấu hình webhook SePay phải trùng SEPAY_WEBHOOK_KEY');
  }
  out.ok = out.webhook_key && out.api_key && out.account && (!out.sepay_api || out.sepay_api.ok) && hints.length === 0;
  if (hints.length) out.hints = hints;
  return out;
}

module.exports = { check, _reset: () => { apiCache = null; } };
