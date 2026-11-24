// lib/routes/support.js (phục vụ tại /api/support) - Form "Gửi yêu cầu hỗ trợ / khiếu nại" (support.html)
//   POST { category, order_code?, phone, amount?, description }
//   GET                                   phiếu hỗ trợ của thành viên đang đăng nhập (kèm phản hồi của CSKH)
//   POST ?action=reply { ticket_code, message }   thành viên trả lời trên phiếu của mình (mở lại phiếu)
// - Vấn đề "đã chuyển tiền nhưng chưa nhận vé" kèm mã đơn hợp lệ -> chạy luồng báo lỗi thanh toán
//   (tra cứu cổng ngay + phiếu ưu tiên cao, giống nút Báo lỗi).
// - Các vấn đề khác -> phiếu GENERAL cho CSKH xử lý ở admin.html.
const Store = require('../store');
const Flow = require('../flow');
const Auth = require('../auth');
const Throttle = require('../throttle');
const { fail, clean } = require('../api-util');

const CATEGORIES = {
  PAYMENT_NO_TICKET: 'Chuyển khoản thành công nhưng chưa nhận vé',
  WRONG_TRANSFER: 'Chuyển nhầm số tiền hoặc sai nội dung',
  REFUND: 'Yêu cầu hoàn tiền vé theo chính sách',
  CHANGE_SHOWTIME: 'Đổi suất chiếu do sự cố bất khả kháng',
  SERVICE: 'Phản ánh chất lượng dịch vụ phòng chiếu'
};

const genCode = () => 'CS-' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const STATUS_LABEL = { OPEN: 'Đang xử lý', WAITING_CUSTOMER: 'Chờ bạn phản hồi', WAITING_ACCOUNTING: 'Đang chờ Kế toán', RESOLVED: 'Đã giải quyết' };

// Khách chỉ thấy phần cần thiết: nội dung, trạng thái, các phản hồi (không lộ ghi chú nội bộ)
const publicTicket = (t) => ({
  code: t.code, order_code: t.order_code, status: t.status, status_label: STATUS_LABEL[t.status] || t.status,
  category_label: (t.context && t.context.category_label) || '', description: (t.context && t.context.description) || t.summary,
  replies: (Array.isArray(t.replies) ? t.replies : []).map(r => ({ at: r.at, from: r.from, name: r.from === 'STAFF' ? 'CSKH Beta' : r.name, message: r.message })),
  created_at: t.created_at, updated_at: t.updated_at
});

async function mine(req, res) {
  const me = await Auth.currentCustomer(req);
  if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để xem phiếu hỗ trợ' });
  const list = await Store.find('support_tickets', { customer_id: me.id }, { order: 'created_at', asc: false, limit: 50 });
  return res.status(200).json({ ok: true, tickets: list.map(publicTicket) });
}

async function reply(req, res, b) {
  const me = await Auth.currentCustomer(req);
  if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập' });
  const message = clean(b.message).slice(0, 1000);
  if (message.length < 2) return res.status(400).json({ ok: false, error: 'Nhập nội dung trả lời' });
  const t = await Store.one('support_tickets', { code: clean(b.ticket_code).toUpperCase() });
  if (!t || t.customer_id !== me.id) return res.status(404).json({ ok: false, error: 'Không tìm thấy phiếu hỗ trợ' });
  const replies = [...(Array.isArray(t.replies) ? t.replies : []), { at: new Date().toISOString(), from: 'CUSTOMER', name: me.full_name, message }].slice(-100);
  const [u] = await Store.update('support_tickets', { code: t.code }, { replies, status: 'OPEN', updated_at: new Date().toISOString() });
  return res.status(200).json({ ok: true, ticket: publicTicket(u) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return await mine(req, res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if ((req.query && req.query.action) === 'reply') return await reply(req, res, req.body || {});
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
    // Phiếu gắn với một đơn: chỉ chủ đơn (đăng nhập đúng tài khoản) hoặc người nhập đúng SĐT đã dùng khi đặt vé
    // (trước đây người lạ biết mã đơn là tạo được khiếu nại "đã chuyển tiền chưa có vé" cho đơn bất kỳ)
    if (order) {
      const vn = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('84') ? '0' + d.slice(2) : d; };
      const owner = !!(me && order.user_id && order.user_id === me.id);
      if (!owner && !(order.phone && vn(order.phone) === vn(phone))) {
        return res.status(403).json({ ok: false, error: 'Số điện thoại không khớp với đơn hàng – vui lòng nhập đúng số điện thoại đã dùng khi đặt vé (hoặc đăng nhập đúng tài khoản đặt vé).' });
      }
    }
    // Ô "Tôi không phải robot" (Cloudflare Turnstile) – chỉ kiểm tra khi đã đặt khóa (lib/turnstile.js)
    await require('../turnstile').verify(req, 'support');
    // Chống spam: mỗi IP tối đa 5 phiếu / 15 phút (không rõ IP – kiểm thử gọi thẳng hàm – thì bỏ qua)
    const ip = require('../ratelimit').ipOf(req);
    if (ip && ip !== 'unknown') {
      try { await Throttle.check('sup:' + ip); } catch (e) { return res.status(429).json({ ok: false, error: 'Bạn đã gửi nhiều yêu cầu liên tiếp. Vui lòng thử lại sau ít phút.' }); }
      await Throttle.fail('sup:' + ip, 5);
    }

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
      customer_id: me ? me.id : null,
      replies: [],
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
