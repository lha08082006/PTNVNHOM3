// api/reconcile.js - Đối soát tự động cho BetaBot (Giải quyết tình huống 3: Tiền đã trừ nhưng web chưa nhảy vé)
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const orderCode = (body.order_code || '').trim().toUpperCase();
    const bankRef = (body.bank_ref || '').trim();
    const phone = body.phone || '0987654321';
    const amount = Number(body.amount || 0);

    if (!orderCode && !bankRef) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Mã đơn hàng hoặc Mã giao dịch ngân hàng' });
    }

    // 1. Tìm trong sổ cái giao dịch ngân hàng (bank_transactions)
    const tx = await DB.findBankTransaction(bankRef, orderCode);
    const order = await DB.getOrderByCode(orderCode);

    if (tx && order) {
      // Đã tìm thấy giao dịch ngân hàng!
      const isExpired = new Date() > new Date(order.hold_expires_at) || order.status === 'EXPIRED';

      if (!isExpired) {
        // Khôi phục và xuất vé ngay lập tức
        await DB.updateOrder(order.id, {
          status: 'PAID',
          paid_amount: tx.amount || order.total,
          paid_at: new Date().toISOString()
        });
        await DB.saveBankTransaction({
          ...tx,
          result: 'RECOVERED',
          note: 'Đối soát thủ công thành công qua BetaBot AI'
        });

        return res.status(200).json({
          ok: true,
          status: 'RECOVERED_PAID',
          message: 'Đối soát thành công! Hệ thống đã khớp lệnh chuyển khoản và xuất vé ngay cho bạn.',
          code: order.code,
          ticket_url: `ticket.html?order=${order.code}`
        });
      } else {
        // Giao dịch có thật nhưng đơn đã quá giờ giữ ghế -> Chuyển sang hoàn tiền
        let refund = await DB.getRefund({ order_id: order.id });
        if (!refund) {
          refund = await DB.createRefund({
            order_id: order.id,
            amount: tx.amount || order.total,
            reason: 'LATE',
            status: 'WAITING_INFO'
          });
        }
        return res.status(200).json({
          ok: true,
          status: 'RECOVERED_REFUND',
          message: 'Hệ thống đã tìm thấy giao dịch ngân hàng, nhưng đơn hàng đã quá 10 phút giữ ghế. Hồ sơ hoàn tiền 100% đã được tạo.',
          code: order.code,
          refund_code: refund.code,
          refund_url: `refund.html?order=${order.code}`
        });
      }
    }

    // 2. Nếu đơn hàng có tồn tại và khách báo mã FT nhưng chưa có trong webhook
    // (Ví dụ: Giả lập trường hợp mạng lag / webhook SePay đến trễ)
    if (order && bankRef) {
      // Kiểm tra nếu là trong môi trường demo hoặc khách cung cấp đủ bằng chứng
      // Tự động tạo khiếu nại (Complaints) để bảo vệ quyền lợi khách hàng
      const complaint = await DB.createComplaint({
        bank_ref: bankRef,
        order_code: orderCode,
        phone: phone,
        amount: amount || order.total,
        description: `Khách báo lỗi chuyển khoản không xuất vé. Mã GD: ${bankRef}. Trạng thái: Chờ ngân hàng xác nhận.`
      });

      return res.status(200).json({
        ok: false,
        status: 'COMPLAINT_CREATED',
        message: `Hệ thống chưa nhận được biến động từ ngân hàng cho mã giao dịch "${bankRef}". Đã tạo phiếu khiếu nại CSKH #${complaint.code}. Nhân viên sẽ đối soát và liên hệ trong 15 phút.`,
        complaint_code: complaint.code
      });
    }

    return res.status(404).json({
      ok: false,
      error: 'Không tìm thấy thông tin đơn hàng tương ứng để đối soát.'
    });
  } catch (error) {
    console.error('[API reconcile Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi đối soát giao dịch' });
  }
};
