// api/reconcile.js - BetaBot "Hỗ trợ đối soát" (REQ-04)
// BetaBot KHÔNG tự đánh dấu đã thanh toán. Nó ghi nhận báo lỗi của khách (tạo ticket ưu tiên
// có sẵn ngữ cảnh), buộc tra cứu cổng thanh toán ngay, rồi trả lời theo trạng thái thật của đơn.
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const Access = require('../lib/access');
const { fail, clean } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const b = req.body || {};
    const code = clean(b.order_code).toUpperCase();
    const bankRef = clean(b.bank_ref).slice(0, 40);
    let order = code ? await Store.one('orders', { code }) : null;

    if (!order && bankRef) {
      const tx = await Store.one('bank_transactions', { reference_code: bankRef });
      if (tx && tx.code) order = await Store.one('orders', { code: tx.code });
    }
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng. Vui lòng kiểm tra lại mã đơn (BCxxxxxxxxxx) in trên màn hình thanh toán.' });
    }

    const { order: after, ticket } = await Flow.reportIssue(order, { bank_ref: bankRef, note: 'Báo lỗi qua BetaBot' });
    const v = await Access.viewFor(req, after);
    const base = { ok: true, code: v.code, order: v, ticket_code: ticket.code, track_url: `order.html?code=${v.code}` };

    if (v.has_ticket) {
      return res.status(200).json({ ...base, status: 'RECOVERED_PAID', ticket_url: `ticket.html?order=${v.code}`,
        message: v.status === 'CONFIRMED_LATE'
          ? 'Đối soát thành công: tiền đã vào trước hạn giữ ghế và ghế vẫn còn trống, hệ thống đã cấp vé bù cho bạn.'
          : 'Đối soát thành công: cổng thanh toán xác nhận giao dịch khớp mã đơn và số tiền, vé đã được xuất.' });
    }
    if (['REFUND_REQUESTED', 'REFUNDED', 'MANUAL_REVIEW'].includes(v.status)) {
      const rf = v.refund;
      return res.status(200).json({ ...base, status: 'RECOVERED_REFUND', refund_url: `order.html?code=${v.code}`,
        message: v.status === 'MANUAL_REVIEW'
          ? `Hệ thống đã ghi nhận tiền của bạn nhưng chưa thể tự hoàn. Vui lòng điền biểu mẫu nhận hoàn tiền để CSKH xử lý (phiếu #${ticket.code}).`
          : `Không thể cấp vé (${rf ? rf.reason_label.toLowerCase() : 'ghế không còn'}). Hệ thống đã tự động hoàn ${new Intl.NumberFormat('vi-VN').format(rf ? rf.amount : v.paid_amount)}đ về tài khoản đã chuyển – bạn không cần làm thêm thủ tục.` });
    }
    return res.status(200).json({ ...base, status: 'COMPLAINT_CREATED', complaint_code: ticket.code,
      message: v.status === 'EXPIRED'
        ? `Cổng thanh toán chưa xác nhận giao dịch. Đơn đang trong danh sách đối soát tự động 30 phút/lần (tối đa 24 giờ); nếu tiền đã bị trừ bạn sẽ được cấp vé bù hoặc hoàn tiền tự động. Phiếu hỗ trợ #${ticket.code} đã được chuyển CSKH.`
        : v.status === 'CANCELLED'
          ? `Đơn đã hủy và hệ thống chưa thấy giao dịch nào khớp mã đơn. Phiếu hỗ trợ #${ticket.code} đã được chuyển CSKH để đối chiếu sao kê.`
          : `Hệ thống đang xác minh giao dịch với cổng thanh toán (${v.status_sublabel.toLowerCase()}). Phiếu hỗ trợ #${ticket.code} đã được tạo kèm đầy đủ thông tin đơn – bạn không cần cung cấp lại.` });
  } catch (e) {
    return fail(res, e);
  }
};
