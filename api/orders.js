// api/orders.js - Lịch sử đơn hàng của khách (US-03: nhãn trạng thái + tiến trình hoàn tiền)
//   Đã đăng nhập  -> các đơn của chính thành viên đó
//   Chưa đăng nhập -> chỉ tra được theo ?codes=BC...,BC... và chỉ thấy trạng thái (không có thông tin cá nhân / mã QR)
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const Auth = require('../lib/auth');
const Access = require('../lib/access');
const { fail, clean } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const limit = Math.min(50, Number(req.query.limit || 20));
    const me = await Auth.currentCustomer(req);
    const codes = clean(req.query.codes).toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
    const filter = {};
    if (me) filter.user_id = me.id;
    else if (codes.length) filter.code = { in: codes };
    else return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để xem lịch sử đơn hàng' });
    if (me && codes.length) filter.code = { in: codes };

    const rows = await Store.find('orders', filter, { limit });
    const out = [];
    for (let o of rows) {
      if (['PENDING', 'EXPIRED', 'REFUND_REQUESTED'].includes(o.status)) o = (await Flow.tick(o)) || o;
      const v = await Flow.view(o);
      out.push(me ? v : Access.redact(v));
    }
    return res.status(200).json({ ok: true, orders: out });
  } catch (e) {
    return fail(res, e);
  }
};
