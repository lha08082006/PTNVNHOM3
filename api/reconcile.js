// api/reconcile.js - Đối soát cho BetaBot ("tiền đã trừ nhưng web chưa xuất vé")
const DB = require('../lib/db');
const { applyPayment } = require('../lib/payment');

// Các kết quả nghĩa là tiền của giao dịch đã được cộng vào đơn
const APPLIED_RESULTS = new Set(['OK', 'SHORT', 'EXCESS', 'LATE', 'DUPLICATE', 'RECOVERED']);

function paidResponse(order, message, extra = {}) {
  return {
    ok: true,
    status: 'RECOVERED_PAID',
    message,
    code: order.code,
    ticket_url: `ticket.html?order=${order.code}`,
    ...extra
  };
}

function refundResponse(order, refund, message) {
  return {
    ok: true,
    status: 'RECOVERED_REFUND',
    message,
    code: order.code,
    refund_code: refund ? refund.code : null,
    refund_url: `refund.html?order=${order.code}`
  };
}

// Kết quả cho một đơn có giao dịch đã được xử lý trước đó
async function describeOrder(order) {
  if (order.status === 'PAID') {
    return paidResponse(order, 'Đơn hàng đã được thanh toán thành công. Vé của bạn đã sẵn sàng.');
  }
  const refund = await DB.getRefund({ order_id: order.id });
  if (refund) {
    return refundResponse(order, refund, 'Giao dịch đã được ghi nhận nhưng đơn không thể xuất vé. Hồ sơ hoàn tiền đã được tạo.');
  }
  if (order.status === 'PARTIAL') {
    const remaining = Math.max(0, Number(order.total) - Number(order.paid_amount || 0));
    return {
      ok: true,
      status: 'PARTIAL',
      code: order.code,
      remaining_amount: remaining,
      message: `Hệ thống đã nhận một phần tiền. Vui lòng chuyển bù ${remaining.toLocaleString('vi-VN')}đ để nhận vé.`,
      underpay_url: `underpay.html?order=${order.code}`
    };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const orderCode = String(body.order_code || '').trim().toUpperCase();
    const bankRef = String(body.bank_ref || '').trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const amount = Number(body.amount || 0);

    if (!orderCode && !bankRef) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Mã đơn hàng hoặc Mã giao dịch ngân hàng' });
    }

    // 1. Tìm giao dịch trong sổ cái
    const tx = bankRef
      ? await DB.findBankTransaction({ reference_code: bankRef })
      : await DB.findBankTransaction({ order_code: orderCode });

    // Đơn liên quan: ưu tiên đơn mà giao dịch đã gắn, sau đó tới mã khách cung cấp
    let order = null;
    if (tx && tx.order_id) order = await DB.getOrderById(tx.order_id);
    if (!order && tx && tx.code) order = await DB.getOrderByCode(tx.code);
    if (!order && orderCode) order = await DB.getOrderByCode(orderCode);

    // Giao dịch đã gắn với một đơn khác đơn khách báo -> không dùng chéo
    if (tx && order && orderCode && order.code !== orderCode && (tx.order_id || tx.code)) {
      return res.status(409).json({
        ok: false,
        error: `Mã giao dịch ${bankRef} thuộc về đơn khác, không thể dùng cho đơn #${orderCode}.`
      });
    }

    if (tx && order) {
      // 2a. Tiền đã được cộng vào đơn trước đó -> chỉ báo lại kết quả
      if (APPLIED_RESULTS.has(tx.result)) {
        const described = await describeOrder(order);
        if (described) return res.status(200).json(described);
      } else {
        // 2b. Giao dịch chưa được áp (webhook trễ / lỗi / không khớp mã) -> áp ngay bây giờ
        const outcome = applyPayment(order, tx.amount);
        if (outcome.result === 'IGNORED') {
          return res.status(422).json({ ok: false, error: 'Giao dịch không hợp lệ để đối soát (số tiền bằng 0).' });
        }
        const updated = (await DB.updateOrder(order.id, outcome.updates)) || { ...order, ...outcome.updates };
        let refund = null;
        if (outcome.refund) {
          refund = await DB.createRefund({
            order_id: order.id,
            bank_tx_id: tx.id,
            amount: outcome.refund.amount,
            reason: outcome.refund.reason
          });
        }
        await DB.updateBankTransaction(tx.id, {
          order_id: order.id,
          code: order.code,
          result: outcome.result === 'OK' ? 'RECOVERED' : outcome.result,
          note: 'Đối soát qua BetaBot: ' + outcome.note
        });

        if (updated.status === 'PAID') {
          return res.status(200).json(paidResponse(
            updated,
            'Đối soát thành công! Hệ thống đã khớp lệnh chuyển khoản và xuất vé ngay cho bạn.' +
              (outcome.refund ? ' Phần tiền thừa đã được lập hồ sơ hoàn.' : ''),
            refund ? { refund_code: refund.code } : {}
          ));
        }
        if (refund) {
          return res.status(200).json(refundResponse(
            updated, refund,
            'Hệ thống đã tìm thấy giao dịch ngân hàng, nhưng đơn hàng đã quá 10 phút giữ ghế. Hồ sơ hoàn tiền 100% đã được tạo.'
          ));
        }
        const described = await describeOrder(updated);
        if (described) return res.status(200).json(described);
      }
    }

    // 3. Đơn đã thanh toán / có hồ sơ hoàn dù không có mã GD -> báo trạng thái
    if (order && !bankRef) {
      const described = await describeOrder(order);
      if (described) return res.status(200).json(described);
    }

    // 4. Khách có mã giao dịch nhưng sổ cái chưa thấy -> tạo khiếu nại để nhân viên đối soát
    if (bankRef) {
      const complaint = await DB.createComplaint({
        bank_ref: bankRef,
        order_code: orderCode || null,
        phone,
        amount: amount || (order ? order.total : 0),
        description: `Khách báo chuyển khoản nhưng không xuất vé. Mã GD: ${bankRef}. Trạng thái: chờ ngân hàng xác nhận.`
      });
      return res.status(200).json({
        ok: false,
        status: 'COMPLAINT_CREATED',
        message: `Hệ thống chưa nhận được biến động từ ngân hàng cho mã giao dịch này. Đã tạo phiếu khiếu nại CSKH #${complaint.code}. Nhân viên sẽ đối soát và liên hệ trong 15 phút.`,
        complaint_code: complaint.code
      });
    }

    return res.status(404).json({
      ok: false,
      error: 'Không tìm thấy giao dịch cho đơn hàng này. Vui lòng cung cấp mã giao dịch ngân hàng (FT...).'
    });
  } catch (error) {
    console.error('[API reconcile Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi đối soát giao dịch' });
  }
};
