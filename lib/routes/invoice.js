// lib/routes/invoice.js (phục vụ tại /api/invoice) - Khách yêu cầu xuất hóa đơn điện tử (Đợt 4)
//   GET  ?code=BC...    yêu cầu hiện tại của đơn + còn được gửi không
//   POST { order_code, buyer_type: COMPANY|PERSONAL, tax_code, company_name, address, buyer_name, email }
const Auth = require('../auth');
const EInvoice = require('../einvoice');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  try {
    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập' });
    if (req.method === 'GET') return res.status(200).json({ ok: true, ...(await EInvoice.getFor(me, clean((req.query || {}).code))) });
    if (req.method === 'POST') return res.status(200).json({ ok: true, request: await EInvoice.submit(me, req.body || {}) });
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    return fail(res, e);
  }
};
