// api/orders.js - Lịch sử đơn hàng của khách (US-03: nhãn trạng thái + tiến trình hoàn tiền)
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const { fail, clean } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const limit = Math.min(50, Number(req.query.limit || 20));
    const filter = {};
    if (clean(req.query.phone)) filter.phone = clean(req.query.phone);
    if (clean(req.query.codes)) {
      filter.code = { in: clean(req.query.codes).toUpperCase().split(',').map(s => s.trim()).filter(Boolean) };
    }
    const rows = await Store.find('orders', filter, { limit });
    const out = [];
    for (let o of rows) {
      if (['PENDING', 'EXPIRED', 'REFUND_REQUESTED'].includes(o.status)) o = (await Flow.tick(o)) || o;
      out.push(await Flow.view(o));
    }
    return res.status(200).json({ ok: true, orders: out });
  } catch (e) {
    return fail(res, e);
  }
};
