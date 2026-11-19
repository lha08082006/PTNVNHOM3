// lib/payments.js - Cổng thanh toán ví / thẻ (Đợt 4): VNPay, MoMo, ZaloPay
//
// Thiết kế: tiền vào từ cổng nào cũng được ghi vào CÙNG sổ cái bank_transactions (như VietQR/SePay),
// rồi gọi Flow.tick(...) -> toàn bộ quy trình đối soát 3 tầng (xuất vé, cấp vé bù, hoàn tiền,
// chống trùng) dùng lại nguyên vẹn. Mỗi giao dịch có reference_code "<CỔNG>:<mã GD của cổng>"
// (unique) nên IPN / return URL gọi lại nhiều lần không ghi trùng.
//
// Cổng chỉ BẬT khi đủ biến môi trường (khóa sandbox / production do đối tác cấp):
//   VNPay  : VNPAY_TMN_CODE, VNPAY_HASH_SECRET            [VNPAY_PAY_URL, VNPAY_API_URL]
//   MoMo   : MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY   [MOMO_ENDPOINT]
//   ZaloPay: ZALOPAY_APP_ID, ZALOPAY_KEY1, ZALOPAY_KEY2   [ZALOPAY_ENDPOINT]
// Mặc định dùng địa chỉ SANDBOX của từng cổng. Đặt *_URL / *_ENDPOINT sang production khi ký hợp đồng.
//
// CHƯA kiểm chứng với sandbox thật (chưa có khóa): chữ ký viết theo tài liệu công khai của từng cổng
// (VNPay 2.1.0, MoMo API v2, ZaloPay API v2). Khi có khóa: chạy thử 1 giao dịch ở mỗi cổng trước khi mở bán.
const crypto = require('crypto');
const Store = require('./store');

const hmac = (alg, key, data) => crypto.createHmac(alg, key).update(Buffer.from(data, 'utf-8')).digest('hex');
const env = (k, d = '') => String(process.env[k] || d).trim();
const iso = (d) => new Date(d).toISOString();
const ORDER_RE = /(BC\d{10})/;
const httpError = (msg, http) => Object.assign(new Error(msg), { http });

// Giờ Việt Nam dạng yyyyMMddHHmmss / yyMMdd
const vnStamp = (d) => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);

// Cho phép kiểm thử thay hàm gọi mạng (không gọi cổng thật)
const net = { fetch: (...a) => fetch(...a) };
async function postJson(url, body, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('Cổng trả về không phải JSON (HTTP ' + r.status + ')'); }
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------
// VNPay 2.1.0
// ---------------------------------------------------------------------------
// Chuỗi ký: tham số vnp_* sắp xếp theo tên, giá trị encodeURIComponent (khoảng trắng -> "+"), nối bằng "&"
const vnpEncode = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
const vnpSignData = (params) => Object.keys(params).filter(k => k.startsWith('vnp_') && k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType' && params[k] !== '' && params[k] != null)
  .sort().map(k => k + '=' + vnpEncode(params[k])).join('&');

const VNPAY = {
  id: 'VNPAY', label: 'VNPay (thẻ ATM, Visa/Master, QR ngân hàng)',
  enabled: () => !!(env('VNPAY_TMN_CODE') && env('VNPAY_HASH_SECRET')),
  async create(order, amount, { returnUrl, ip }) {
    const now = Date.now();
    const txnRef = order.code + 'T' + now.toString(36).toUpperCase();
    const p = {
      vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: env('VNPAY_TMN_CODE'), vnp_Amount: String(amount * 100),
      vnp_CurrCode: 'VND', vnp_TxnRef: txnRef, vnp_OrderInfo: 'Thanh toan don ' + order.code, vnp_OrderType: 'other',
      vnp_Locale: 'vn', vnp_ReturnUrl: returnUrl, vnp_IpAddr: ip || '127.0.0.1',
      vnp_CreateDate: vnStamp(now), vnp_ExpireDate: vnStamp(order.hold_expires_at)
    };
    const hash = hmac('sha512', env('VNPAY_HASH_SECRET'), vnpSignData(p));
    const url = env('VNPAY_PAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html') + '?' + vnpSignData(p) + '&vnp_SecureHash=' + hash;
    return { pay_url: url, provider_ref: txnRef };
  },
  // IPN (GET) và return URL dùng chung cách kiểm tra
  verify(params) {
    const ok = !!params.vnp_SecureHash && hmac('sha512', env('VNPAY_HASH_SECRET'), vnpSignData(params)).toLowerCase() === String(params.vnp_SecureHash).toLowerCase();
    if (!ok) return { valid: false };
    return {
      valid: true, paid: params.vnp_ResponseCode === '00' && (params.vnp_TransactionStatus == null || params.vnp_TransactionStatus === '00'),
      order_code: (String(params.vnp_TxnRef || '').match(ORDER_RE) || [])[1] || null, amount: Math.round(Number(params.vnp_Amount || 0) / 100),
      txn_id: String(params.vnp_TransactionNo || params.vnp_TxnRef), at: params.vnp_PayDate ? vnDateToIso(params.vnp_PayDate) : iso(Date.now()),
      extra: { txn_ref: params.vnp_TxnRef, bank: params.vnp_BankCode, card: params.vnp_CardType, pay_date: params.vnp_PayDate }
    };
  },
  ipnReply: (code, message) => ({ status: 200, json: { RspCode: code, Message: message } }),
  async refund({ amount, tx, reason }) {
    const ex = (tx.raw && tx.raw.extra) || {};
    const now = Date.now();
    const p = {
      vnp_RequestId: 'R' + now.toString(36).toUpperCase(), vnp_Version: '2.1.0', vnp_Command: 'refund', vnp_TmnCode: env('VNPAY_TMN_CODE'),
      vnp_TransactionType: '02', vnp_TxnRef: ex.txn_ref, vnp_Amount: String(amount * 100), vnp_TransactionNo: tx.reference_code.split(':')[1],
      vnp_TransactionDate: ex.pay_date || vnStamp(tx.transaction_date), vnp_CreateBy: 'beta-system', vnp_CreateDate: vnStamp(now), vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: 'Hoan tien ' + (reason || '')
    };
    const data = [p.vnp_RequestId, p.vnp_Version, p.vnp_Command, p.vnp_TmnCode, p.vnp_TransactionType, p.vnp_TxnRef, p.vnp_Amount, p.vnp_TransactionNo, p.vnp_TransactionDate, p.vnp_CreateBy, p.vnp_CreateDate, p.vnp_IpAddr, p.vnp_OrderInfo].join('|');
    p.vnp_SecureHash = hmac('sha512', env('VNPAY_HASH_SECRET'), data);
    const r = await postJson(env('VNPAY_API_URL', 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'), p);
    return r.vnp_ResponseCode === '00' ? { ok: true, ref: 'VNPAY-RF:' + (r.vnp_TransactionNo || p.vnp_RequestId) } : { ok: false, error: 'VNPay refund ' + r.vnp_ResponseCode + ': ' + (r.vnp_Message || '') };
  }
};
function vnDateToIso(s) { const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s)); return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`).toISOString() : iso(Date.now()); }

// ---------------------------------------------------------------------------
// MoMo API v2 (captureWallet)
// ---------------------------------------------------------------------------
const momoEndpoint = () => env('MOMO_ENDPOINT', 'https://test-payment.momo.vn').replace(/\/+$/, '');
const MOMO = {
  id: 'MOMO', label: 'Ví MoMo',
  enabled: () => !!(env('MOMO_PARTNER_CODE') && env('MOMO_ACCESS_KEY') && env('MOMO_SECRET_KEY')),
  async create(order, amount, { returnUrl, ipnUrl }) {
    const orderId = order.code + '-' + Date.now().toString(36).toUpperCase();
    const b = {
      partnerCode: env('MOMO_PARTNER_CODE'), requestId: orderId, amount: String(amount), orderId, orderInfo: 'Thanh toan don ' + order.code,
      redirectUrl: returnUrl, ipnUrl, requestType: 'captureWallet', extraData: '', lang: 'vi', autoCapture: true,
      orderExpireTime: Math.max(1, Math.round((new Date(order.hold_expires_at) - Date.now()) / 60000))
    };
    const raw = `accessKey=${env('MOMO_ACCESS_KEY')}&amount=${b.amount}&extraData=${b.extraData}&ipnUrl=${b.ipnUrl}&orderId=${b.orderId}&orderInfo=${b.orderInfo}&partnerCode=${b.partnerCode}&redirectUrl=${b.redirectUrl}&requestId=${b.requestId}&requestType=${b.requestType}`;
    b.signature = hmac('sha256', env('MOMO_SECRET_KEY'), raw);
    const r = await postJson(momoEndpoint() + '/v2/gateway/api/create', b);
    if (Number(r.resultCode) !== 0 || !r.payUrl) throw httpError('MoMo từ chối tạo giao dịch: ' + (r.message || r.resultCode), 502);
    return { pay_url: r.payUrl, provider_ref: orderId };
  },
  verify(p) {
    const raw = `accessKey=${env('MOMO_ACCESS_KEY')}&amount=${p.amount}&extraData=${p.extraData || ''}&message=${p.message}&orderId=${p.orderId}&orderInfo=${p.orderInfo}&orderType=${p.orderType}&partnerCode=${p.partnerCode}&payType=${p.payType}&requestId=${p.requestId}&responseTime=${p.responseTime}&resultCode=${p.resultCode}&transId=${p.transId}`;
    if (!p.signature || hmac('sha256', env('MOMO_SECRET_KEY'), raw) !== String(p.signature)) return { valid: false };
    return {
      valid: true, paid: Number(p.resultCode) === 0, order_code: (String(p.orderId || '').match(ORDER_RE) || [])[1] || null,
      amount: Math.round(Number(p.amount) || 0), txn_id: String(p.transId), at: p.responseTime ? iso(Number(p.responseTime)) : iso(Date.now()),
      extra: { order_id: p.orderId, pay_type: p.payType }
    };
  },
  ipnReply: (code) => (code === '97' ? { status: 400, json: { message: 'Invalid signature' } } : { status: 204 }),
  async refund({ amount, tx, reason }) {
    const requestId = 'RF' + Date.now().toString(36).toUpperCase();
    const orderId = ((tx.raw && tx.raw.extra) || {}).order_id + '-' + requestId;
    const transId = tx.reference_code.split(':')[1];
    const description = 'Hoan tien ' + (reason || '');
    const raw = `accessKey=${env('MOMO_ACCESS_KEY')}&amount=${amount}&description=${description}&orderId=${orderId}&partnerCode=${env('MOMO_PARTNER_CODE')}&requestId=${requestId}&transId=${transId}`;
    const r = await postJson(momoEndpoint() + '/v2/gateway/api/refund', { partnerCode: env('MOMO_PARTNER_CODE'), orderId, requestId, amount, transId: Number(transId), lang: 'vi', description, signature: hmac('sha256', env('MOMO_SECRET_KEY'), raw) });
    return Number(r.resultCode) === 0 ? { ok: true, ref: 'MOMO-RF:' + (r.transId || requestId) } : { ok: false, error: 'MoMo refund ' + r.resultCode + ': ' + (r.message || '') };
  }
};

// ---------------------------------------------------------------------------
// ZaloPay API v2
// ---------------------------------------------------------------------------
const zpEndpoint = () => env('ZALOPAY_ENDPOINT', 'https://sb-openapi.zalopay.vn').replace(/\/+$/, '');
const ZALOPAY = {
  id: 'ZALOPAY', label: 'Ví ZaloPay',
  enabled: () => !!(env('ZALOPAY_APP_ID') && env('ZALOPAY_KEY1') && env('ZALOPAY_KEY2')),
  async create(order, amount, { returnUrl, ipnUrl }) {
    const now = Date.now();
    const b = {
      app_id: Number(env('ZALOPAY_APP_ID')), app_user: 'beta_' + String(order.user_id || 'guest').slice(0, 20),
      app_trans_id: vnStamp(now).slice(2, 8) + '_' + order.code + now.toString(36).toUpperCase(), app_time: now, amount,
      item: '[]', description: 'Beta Cinemas - Thanh toan don ' + order.code, embed_data: JSON.stringify({ redirecturl: returnUrl }),
      bank_code: '', callback_url: ipnUrl, expire_duration_seconds: Math.max(300, Math.round((new Date(order.hold_expires_at) - now) / 1000))
    };
    b.mac = hmac('sha256', env('ZALOPAY_KEY1'), [b.app_id, b.app_trans_id, b.app_user, b.amount, b.app_time, b.embed_data, b.item].join('|'));
    const r = await postJson(zpEndpoint() + '/v2/create', b);
    if (Number(r.return_code) !== 1 || !r.order_url) throw httpError('ZaloPay từ chối tạo giao dịch: ' + (r.return_message || r.sub_return_message || r.return_code), 502);
    return { pay_url: r.order_url, provider_ref: b.app_trans_id };
  },
  // Callback: { data: "<json>", mac } với mac = HMAC-SHA256(key2, data). Chỉ gọi khi đã thanh toán thành công.
  verify(p) {
    if (!p.data || !p.mac || hmac('sha256', env('ZALOPAY_KEY2'), String(p.data)) !== String(p.mac)) return { valid: false };
    let d;
    try { d = JSON.parse(p.data); } catch (e) { return { valid: false }; }
    return {
      valid: true, paid: true, order_code: (String(d.app_trans_id || '').match(ORDER_RE) || [])[1] || null, amount: Math.round(Number(d.amount) || 0),
      txn_id: String(d.zp_trans_id), at: d.server_time ? iso(Number(d.server_time)) : iso(Date.now()), extra: { app_trans_id: d.app_trans_id }
    };
  },
  // Trang quay về của ZaloPay không có chữ ký đủ tin cậy -> chỉ dùng để đưa khách về trang đơn, không ghi tiền
  verifyReturn: () => ({ valid: false }),
  ipnReply: (code, message) => ({ status: 200, json: { return_code: code === '00' || code === '02' ? 1 : -1, return_message: message } }),
  async refund({ amount, tx, reason }) {
    const ts = Date.now();
    const appId = Number(env('ZALOPAY_APP_ID'));
    const zpTransId = tx.reference_code.split(':')[1];
    const description = 'Hoan tien ' + (reason || '');
    const m_refund_id = vnStamp(ts).slice(2, 8) + '_' + appId + '_' + ts.toString(36);
    const mac = hmac('sha256', env('ZALOPAY_KEY1'), [appId, zpTransId, amount, description, ts].join('|'));
    const r = await postJson(zpEndpoint() + '/v2/refund', { m_refund_id, app_id: appId, zp_trans_id: zpTransId, amount, timestamp: ts, description, mac });
    // return_code 1 = thành công, 3 = đang xử lý (ZaloPay tự hoàn sau) -> coi như đã gửi lệnh
    return [1, 3].includes(Number(r.return_code)) ? { ok: true, ref: 'ZALOPAY-RF:' + (r.refund_id || m_refund_id) } : { ok: false, error: 'ZaloPay refund ' + r.return_code + ': ' + (r.return_message || '') };
  }
};

const PROVIDERS = { VNPAY, MOMO, ZALOPAY };
const get = (id) => PROVIDERS[String(id || '').toUpperCase()] || null;
const enabled = () => Object.values(PROVIDERS).filter(p => p.enabled()).map(p => ({ id: p.id, label: p.label }));

// Ghi một giao dịch đã xác thực chữ ký vào sổ cái rồi chạy đối soát của đơn
async function record(provider, v) {
  const Flow = require('./flow');
  const ref = provider.id + ':' + v.txn_id;
  if (await Store.one('bank_transactions', { reference_code: ref })) return { duplicate: true };
  const order = v.order_code ? await Store.one('orders', { code: v.order_code }) : null;
  try {
    await Store.insert('bank_transactions', {
      gateway: provider.id, account_number: null, transaction_date: v.at, content: 'Thanh toan don ' + (v.order_code || '?') + ' qua ' + provider.id,
      code: v.order_code, transfer_type: 'in', amount: v.amount, reference_code: ref, raw: { provider: provider.id, extra: v.extra || {} },
      order_id: order ? order.id : null, result: order ? 'MATCHED' : 'UNMATCHED', note: 'IPN ' + provider.id + ' (chữ ký hợp lệ)'
    });
  } catch (e) {
    if (e.code === '23505') return { duplicate: true };
    throw e;
  }
  await Store.update('payment_attempts', { order_code: v.order_code, provider: provider.id, status: 'INIT' }, { status: 'PAID', provider_txn: v.txn_id, updated_at: iso(Date.now()) });
  if (!order) return { unmatched: true };
  const after = await Flow.tick(order, { phase: 'WEBHOOK' });
  return { order: after || order };
}

// Bắt đầu thanh toán: chỉ cho đơn đang chờ, số tiền = phần còn thiếu
async function start(order, providerId, ctx) {
  const p = get(providerId);
  if (!p || !p.enabled()) throw httpError('Cổng thanh toán này chưa được bật', 400);
  if (order.status !== 'PENDING') throw httpError('Đơn không còn ở trạng thái chờ thanh toán', 409);
  if (new Date(order.hold_expires_at) <= new Date()) throw httpError('Đơn đã hết thời gian giữ chỗ', 409);
  const amount = Math.max(0, Number(order.total) - Number(order.paid_amount || 0));
  if (!amount) throw httpError('Đơn đã đủ tiền', 409);
  const r = await p.create(order, amount, ctx);
  await Store.insert('payment_attempts', { order_code: order.code, provider: p.id, provider_ref: r.provider_ref, amount, status: 'INIT', pay_url: r.pay_url, updated_at: iso(Date.now()) });
  return { provider: p.id, amount, pay_url: r.pay_url };
}

// Hoàn tiền về ví / thẻ cho giao dịch đi qua cổng. Trả null nếu giao dịch không phải của cổng nào.
async function refundFor(refund) {
  const refs = String(refund.tx_refs || '').split('+').filter(Boolean);
  const mine = refs.filter(r => /^(VNPAY|MOMO|ZALOPAY):/.test(r));
  if (!mine.length) return null;
  if (mine.length !== refs.length) return { ok: false, manual: true, error: 'Đơn trả bằng nhiều kênh (ví/thẻ và chuyển khoản) – cần hoàn thủ công' };
  const tx = await Store.one('bank_transactions', { reference_code: mine[mine.length - 1] });
  const p = tx && get(tx.gateway);
  if (!p) return { ok: false, manual: true, error: 'Không tìm thấy giao dịch cổng ' + mine[0] };
  if (!p.enabled()) return { ok: false, manual: true, error: 'Cổng ' + p.id + ' chưa cấu hình khóa – cần hoàn thủ công' };
  if (Number(refund.amount) > Number(tx.amount)) return { ok: false, manual: true, error: 'Số tiền hoàn lớn hơn giao dịch cổng – cần hoàn thủ công' };
  try { return await p.refund({ amount: Number(refund.amount), tx, reason: refund.reason }); }
  catch (e) { return { ok: false, error: p.id + ' refund lỗi: ' + e.message }; }
}

module.exports = { PROVIDERS, get, enabled, start, record, refundFor, net, _test: { vnpSignData, hmac } };
