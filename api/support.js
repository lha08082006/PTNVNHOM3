// api/support.js - Form "Gửi yêu cầu hỗ trợ / khiếu nại" (support.html)
//   POST { category, order_code?, phone, amount?, description }
// - Vấn đề "đã chuyển tiền nhưng chưa nhận vé" kèm mã đơn hợp lệ -> chạy luồng báo lỗi thanh toán
//   (tra cứu cổng ngay + phiếu ưu tiên cao, giống nút Báo lỗi).
// - Các vấn đề khác -> phiếu GENERAL cho CSKH xử lý ở admin.html.
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const Auth = require('../lib/auth');
const { fail, clean } = require('../lib/api-util');

const CATEGORIES = {
  PAYMENT_NO_TICKET: 'Chuyển khoản thành công nhưng chưa nhận vé',
  WRONG_TRANSFER: 'Chuyển nhầm số tiền hoặc sai nội dung',
  REFUND: 'Yêu cầu hoàn tiền vé theo chính sách',
  CHANGE_SHOWTIME: 'Đổi suất chiếu do sự cố bất khả kháng',
  SERVICE: 'Phản ánh chất lượng dịch vụ phòng chiếu'
};

const genCode = () => 'CS-' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const b = req.body || {};
    const category = clean(b.category).toUpperCase();
    const phone = clean(b.phone).replace(/[\s.-]/g, '');
    const description = clean(b.description).slice(0, 1000);
    const amount = clean(b.amount).slice(0, 30);
    const orderCode = clean(b.order_code).toUpperCase();
    if (!CATEGORIES[category]) return res.status(400).json({ ok: false, error: 'Vui lòng chọn loại vấn đề' });
    if (!/^(0|\+84)\d{9,10}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Số điện thoại liên hệ không hợp lệ' });
    if (description.length < 10) return res.status(400).json({ ok: false, error: 'Vui lòng mô tả sự cố (ít nhất 10 ký tự)' });

    const order = orderCode ? await Store.one('orders', { code: orderCode }) : null;
    if (orderCode && !order) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng #' + orderCode });
    const me = await Auth.currentCustomer(req);

    if (order && category === 'PAYMENT_NO_TICKET') {
      const { order: after, ticket } = await Flow.reportIssue(order, {
        note: `${description} | SĐT: ${phone}${amount ? ' | Số tiền: ' + amount : ''}`.slice(0, 500)
      });
      return res.status(200).json({ ok: true, ticket_code: ticket.code, order_status: after.status, status_label: (await Flow.view(after)).status_label });
    }

    const now = new Date().toISOString();
    const ticket = await Store.insert('support_tickets', {
      code: genCode(),
      order_code: order ? order.code : null,
      type: 'GENERAL',
      priority: category === 'REFUND' || category === 'WRONG_TRANSFER' ? 'HIGH' : 'NORMAL',
      status: 'OPEN',
      summary: `${CATEGORIES[category]}: ${description}`.slice(0, 300),
      context: {
        category, category_label: CATEGORIES[category], description, amount: amount || null, phone,
        customer: me ? { id: me.id, name: me.full_name, email: me.email } : null,
        order: order ? { code: order.code, status: order.status, total: order.total, paid_amount: order.paid_amount } : null
      },
      updated_at: now
    });
    return res.status(200).json({ ok: true, ticket_code: ticket.code });
  } catch (e) {
    return fail(res, e);
  }
};
