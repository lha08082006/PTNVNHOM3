// api/sepay-webhook.js - Xử lý Webhook SePay VietQR (Tự động hóa 3 tình huống lỗi thanh toán)
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    console.log('[SePay Webhook Received]:', JSON.stringify(body));

    const transferAmount = Number(body.transferAmount || body.amount || 0);
    const referenceCode = body.referenceCode || body.reference_code || ('FT' + Date.now());
    const rawContent = (body.content || '') + ' ' + (body.code || '');

    // 1. Tìm mã đơn hàng (Định dạng BC + 10 số, ví dụ BC2610279854)
    let orderCode = body.code;
    if (!orderCode || !orderCode.startsWith('BC')) {
      const match = rawContent.match(/BC\d{8,12}/i);
      if (match) orderCode = match[0].toUpperCase();
    }

    // 2. Chống xử lý trùng giao dịch (Idempotency)
    const existingTx = await DB.findBankTransaction(referenceCode, null);
    if (existingTx) {
      console.log('[SePay Webhook] Bỏ qua giao dịch đã xử lý:', referenceCode);
      return res.status(200).json({ success: true, message: 'Giao dịch đã được ghi nhận trước đó', code: orderCode });
    }

    // 3. Nếu không tìm thấy mã đơn hàng trong nội dung chuyển tiền
    if (!orderCode) {
      await DB.saveBankTransaction({
        ...body,
        reference_code: referenceCode,
        amount: transferAmount,
        result: 'UNMATCHED',
        note: 'Không tìm thấy cú pháp mã đơn BC... trong nội dung'
      });
      return res.status(200).json({ success: true, result: 'UNMATCHED', message: 'Không tìm thấy mã đơn' });
    }

    // 4. Tìm đơn hàng tương ứng trong CSDL
    const order = await DB.getOrderByCode(orderCode);
    if (!order) {
      await DB.saveBankTransaction({
        ...body,
        code: orderCode,
        reference_code: referenceCode,
        amount: transferAmount,
        result: 'UNMATCHED',
        note: 'Mã đơn #' + orderCode + ' không tồn tại trong hệ thống'
      });
      return res.status(200).json({ success: true, result: 'UNMATCHED', message: 'Mã đơn không tồn tại' });
    }

    const orderTotal = Number(order.total || 0);
    const prevPaid = Number(order.paid_amount || 0);
    const newPaid = prevPaid + transferAmount;

    // Kiểm tra hết hạn giữ ghế (Quá 10 phút)
    const isExpired = (new Date() > new Date(order.hold_expires_at)) || order.status === 'EXPIRED' || order.status === 'CANCELLED';

    let result = 'OK';
    let refundCreated = null;

    // =========================================================================
    // TÌNH HUỐNG 1: KHÁCH TRẢ THIẾU TIỀN (newPaid < orderTotal)
    // =========================================================================
    if (newPaid < orderTotal) {
      result = 'SHORT';
      if (!isExpired) {
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'PARTIAL'
        });
      } else {
        // Đã hết giờ mà lại trả thiếu -> Đơn hủy, tạo refund phần tiền đã nhận
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'EXPIRED'
        });
        refundCreated = await DB.createRefund({
          order_id: order.id,
          amount: newPaid,
          reason: 'SHORT',
          status: 'WAITING_INFO'
        });
      }
    }

    // =========================================================================
    // TÌNH HUỐNG 2: KHÁCH TRẢ THỪA TIỀN (newPaid > orderTotal)
    // =========================================================================
    else if (newPaid > orderTotal) {
      result = 'EXCESS';
      const excessAmount = newPaid - orderTotal;

      if (!isExpired) {
        // Vẫn xuất vé bình thường để khách kịp xem phim
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'PAID',
          paid_at: new Date().toISOString()
        });
        // Tự động tạo hồ sơ hoàn tiền thừa cho khách
        refundCreated = await DB.createRefund({
          order_id: order.id,
          amount: excessAmount,
          reason: 'EXCESS',
          status: 'WAITING_INFO'
        });
      } else {
        // Quá hạn giữ ghế -> Hoàn lại toàn bộ 100% số tiền đã nhận
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'EXPIRED'
        });
        refundCreated = await DB.createRefund({
          order_id: order.id,
          amount: newPaid,
          reason: 'LATE',
          status: 'WAITING_INFO'
        });
      }
    }

    // =========================================================================
    // TÌNH HUỐNG 3 & THÀNH CÔNG: TRẢ ĐỦ TIỀN (newPaid === orderTotal)
    // =========================================================================
    else {
      if (!isExpired) {
        result = 'OK';
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'PAID',
          paid_at: new Date().toISOString()
        });
      } else {
        // Tình huống 3a: Khách trả đủ nhưng quá 10 phút giữ ghế (Ghế đã nhả)
        result = 'LATE';
        await DB.updateOrder(order.id, {
          paid_amount: newPaid,
          status: 'EXPIRED'
        });
        refundCreated = await DB.createRefund({
          order_id: order.id,
          amount: newPaid,
          reason: 'LATE',
          status: 'WAITING_INFO'
        });
      }
    }

    // 5. Lưu vào sổ cái giao dịch ngân hàng (bank_transactions)
    await DB.saveBankTransaction({
      ...body,
      code: orderCode,
      order_id: order.id,
      reference_code: referenceCode,
      amount: transferAmount,
      result: result,
      note: `Xử lý webhook: ${result} | Nhận: ${transferAmount}đ | Tổng đơn: ${orderTotal}đ | Đã trả: ${newPaid}đ`
    });

    return res.status(200).json({
      success: true,
      result: result,
      order_code: orderCode,
      paid_amount: newPaid,
      total: orderTotal,
      refund: refundCreated || null
    });
  } catch (error) {
    console.error('[SePay Webhook Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi xử lý webhook' });
  }
};
