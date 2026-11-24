// lib/routes/pay.js (phục vụ tại /api/pay) - Thanh toán qua VNPay / MoMo / ZaloPay (Đợt 4)
//   GET  ?action=methods                               các cổng đang bật (VietQR luôn có)
//   POST ?action=start { order_code, provider }        chủ đơn bắt đầu thanh toán -> { pay_url }
//   GET|POST ?action=ipn&provider=vnpay|momo|zalopay   cổng báo kết quả (kiểm chữ ký) -> ghi sổ cái + đối soát
//   GET  ?action=return&provider=...                   khách quay về từ cổng -> chuyển tới trang đơn
// Địa chỉ IPN cần khai báo với cổng: <tên miền web>/api/pay?action=ipn&provider=<vnpay|momo|zalopay>
// (tên miền: trên Vercel là tên miền production, ngoài Vercel là SITE_URL – xem lib/site-url.js)
const Store = require('../store');
const Auth = require('../auth');
const Payments = require('../payments');
const { fail, clean } = require('../api-util');

function base(req) {
  const fromEnv = require('../site-url').envSiteUrl();
  if (fromEnv) return fromEnv;
  const h = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost:5000';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || (/^(localhost|127\.)/.test(h) ? 'http' : 'https');
  return proto + '://' + h;
}
const redirect = (res, url) => { res.statusCode = 302; res.setHeader('Location', url); res.end(); };
const reply = (res, r) => { if (r.json) return res.status(r.status).json(r.json); res.statusCode = r.status; return res.end(); };

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const action = clean(q.action);
  try {
    if (action === 'methods') {
      return res.status(200).json({ ok: true, methods: [{ id: 'VIETQR', label: 'Chuyển khoản VietQR (mọi ngân hàng)' }].concat(Payments.enabled()) });
    }

    if (action === 'start' && req.method === 'POST') {
      const me = await Auth.currentCustomer(req);
      if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập' });
      const b = req.body || {};
      const order = await Store.one('orders', { code: clean(b.order_code).toUpperCase() });
      if (!order || order.user_id !== me.id) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn của bạn' });
      const p = clean(b.provider).toLowerCase();
      const r = await Payments.start(order, p, {
        returnUrl: base(req) + '/api/pay?action=return&provider=' + p,
        ipnUrl: base(req) + '/api/pay?action=ipn&provider=' + p,
        ip: String((req.headers && (req.headers['x-forwarded-for'] || '')) || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '127.0.0.1'
      });
      return res.status(200).json({ ok: true, ...r });
    }

    const provider = Payments.get(q.provider);
    if (!provider || !provider.enabled()) return res.status(404).json({ ok: false, error: 'Cổng thanh toán không hợp lệ hoặc chưa bật' });
    const params = req.method === 'GET' ? q : (req.body || {});

    if (action === 'ipn') {
      const v = provider.verify(params);
      if (!v.valid) { await require('../ops').webhookRejected(provider.id, 'IPN sai chữ ký'); return reply(res, provider.ipnReply('97', 'Invalid signature')); }
      if (!v.paid) {
        await Store.update('payment_attempts', { order_code: v.order_code, provider: provider.id, status: 'INIT' }, { status: 'FAILED', updated_at: new Date().toISOString() });
        return reply(res, provider.ipnReply('00', 'Confirm Success'));
      }
      const r = await Payments.record(provider, v);
      await require('../ops').mark('webhook', { provider: provider.id, code: v.order_code });
      if (r.unmatched) return reply(res, provider.ipnReply('01', 'Order not found'));
      return reply(res, provider.ipnReply(r.duplicate ? '02' : '00', r.duplicate ? 'Order already confirmed' : 'Confirm Success'));
    }

    if (action === 'return') {
      // Kết quả ở trang quay về cũng có chữ ký (VNPay, MoMo): ghi luôn để khách không phải chờ IPN.
      const v = (provider.verifyReturn || provider.verify)(params);
      if (v.valid && v.paid) await Payments.record(provider, v);
      const code = (v.valid && v.order_code) || (JSON.stringify(params).match(/(BC\d{10})/) || [])[1];
      return redirect(res, code ? '/gateway.html?order=' + encodeURIComponent(code) + (v.valid && !v.paid ? '&pay=failed' : '') : '/account.html');
    }

    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
