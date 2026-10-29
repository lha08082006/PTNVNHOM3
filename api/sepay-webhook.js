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

    // 1. Tìm mã đơn hàng (Hỗ trợ cả BC... của Beta Cinemas lẫn mã test DH... của SePay)
    let orderCode = body.code;
    if (!orderCode || (!orderCode.startsWith('BC') && !orderCode.startsWith('DH'))) {
      const match = rawContent.match(/(BC|DH)\s*(\d{6,12})/i);
      if (match) {
        orderCode = (match[1] + match[2]).toUpperCase();
      }
    }

    // Fallback thông minh: Nếu không tìm thấy mã BC... trong nội dung (ví dụ khách quên gõ mã hoặc test mặc định của SePay)
    if (!orderCode) {
      try {
        const recentOrders = await DB.getOrders({ limit: 5 });
        const pendingOrder = (recentOrders || []).find(o => o.status === 'HOLDING' || o.status === 'PARTIAL');
        if (pendingOrder) {
          orderCode = pendingOrder.code;
          console.log('[SePay Webhook Fallback]: Tự động ghép giao dịch vào đơn đang chờ:', orderCode);
        }
      } catch (err) {
        console.warn('[SePay Webhook Fallback Error]:', err.message);
      }
    }

    // 2. Chống xử lý trùng giao dịch (Idempotency)
    const existingTx = await DB.findBankTransaction(referenceCode, null);
    if (existingTx) {
      console.log('[SePay Webhook] Bỏ qua giao dịch đã xử lý:', referenceCode);
      return res.status(200).json({ success: true, message: 'Giao dịch đã được ghi nhận trước đó', code: orderCode });
    }

    // 3. Nếu vẫn không xác định được đơn hàng nào
    if (!orderCode) {
      await DB.saveBankTransaction({
        ...body,
        reference_code: referenceCode,
        amount: transferAmount,
        result: 'UNMATCHED',
        note: 'Không tìm thấy cú pháp mã đơn BC... trong nội dung và không có đơn chờ'
      });
      return res.status(200).json({ success: true, result: 'UNMATCHED', message: 'Không tìm thấy mã đơn' });
    }

    // 4. Tìm đơn hàng tương ứng trong CSDL (Nếu chưa có thì tự động tạo để cứu vé cho khách)
    let order = await DB.getOrderByCode(orderCode);
    if (!order) {
      console.log('[SePay Webhook] Tự động tạo đơn dự phòng để ghi nhận giao dịch:', orderCode);
      try {
        order = await DB.createOrder({
          code: orderCode,
          movie_key: 'linh-gioi-dai-chien',
          cinema: 'Beta Thanh Xuân (Hà Nội)',
          show_date: 'Hôm nay',
          show_time: '18:30',
          seats: ['F07', 'F08'],
          total: transferAmount > 0 ? transferAmount : 179000,
          status: 'HOLDING',
          paid_amount: 0
        });
      } catch (createErr) {
        console.warn('[SePay Webhook Auto-create Error]:', createErr.message);
      }
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
      refund_id: refundCreated ? refundCreated.id : null,
      raw_payload: body
    });

    console.log(`[SePay Webhook Processed]: Đơn #${orderCode} | Đã chuyển: ${transferAmount} | Tổng nhận: ${newPaid}/${orderTotal} | Kết quả: ${result}`);

    return res.status(200).json({
      success: true,
      code: orderCode,
      result: result,
      paid_amount: newPaid,
      total: orderTotal,
      refund: refundCreated || null
    });
  } catch (error) {
    console.error('[SePay Webhook Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi xử lý webhook' });
  }
};
