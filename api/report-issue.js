// api/report-issue.js - Nút "Báo cáo lỗi: Đã chuyển tiền nhưng chưa có vé" (BR-10, BR-11)
// Tạo SupportTicket ưu tiên, kèm sẵn ngữ cảnh giao dịch, và tra cứu cổng thanh toán ngay.
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const { fail, orderCodeOf, clean } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const code = orderCodeOf(req);
    const order = code ? await Store.one('orders', { code }) : null;
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng #' + code });
    const b = req.body || {};
    const { order: after, ticket } = await Flow.reportIssue(order, {
      note: clean(b.note).slice(0, 500),
      bank_ref: clean(b.bank_ref).slice(0, 40)
    });
    return res.status(200).json({ ...(await Flow.view(after)), ticket_code: ticket.code });
  } catch (e) {
    return fail(res, e);
  }
};
