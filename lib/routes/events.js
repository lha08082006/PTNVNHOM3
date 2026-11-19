// lib/routes/events.js (phục vụ tại /api/events) - Thuê rạp / vé nhóm / Private Show (Đợt 3)
//   GET  ?action=kinds                     các loại yêu cầu
//   POST { kind, cinema_id?, date?, time?, guests, movie_id?, contact_name, phone, email?, company?, note? }
//   GET  ?code=EV-xxxxxx&phone=09...        khách tra cứu trạng thái / báo giá
const Auth = require('../auth');
const Events = require('../events');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};
    if (req.method === 'GET' && q.action === 'kinds') return res.status(200).json({ ok: true, kinds: Events.KINDS });
    if (req.method === 'GET') return res.status(200).json({ ok: true, request: await Events.lookup(clean(q.code), clean(q.phone)) });
    if (req.method === 'POST') return res.status(200).json({ ok: true, request: await Events.create(req.body || {}, await Auth.currentCustomer(req)) });
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    return fail(res, e);
  }
};
