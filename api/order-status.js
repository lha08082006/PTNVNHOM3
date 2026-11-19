// api/order-status.js - Trạng thái đơn theo thời gian thực (REQ-03).
// Mỗi lần hỏi cũng "đẩy" đơn tiến theo lịch Tầng 1/Tầng 2, nên quy trình vẫn chạy
// khi máy chủ là serverless (Vercel không có tiến trình chạy nền).
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const Access = require('../lib/access');
const { fail, orderCodeOf } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const code = orderCodeOf(req);
    if (!code) return res.status(400).json({ error: 'Thiếu mã đơn hàng (code)' });
    let order = await Store.one('orders', { code });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng #' + code });
    order = (await Flow.tick(order)) || (await Store.one('orders', { code }));
    // Chủ đơn / nhân viên xem đầy đủ; người chỉ biết mã đơn chỉ thấy trạng thái (lib/access.js)
    return res.status(200).json(await Access.viewFor(req, order));
  } catch (e) {
    return fail(res, e);
  }
};
