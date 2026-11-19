// lib/payment.js - Quy tắc xử lý một khoản tiền VÀO cho một đơn hàng (hàm thuần, dễ kiểm thử)
// Dùng chung cho webhook SePay và đối soát BetaBot để hai luồng luôn cho kết quả giống nhau.

function isHoldExpired(order, now = new Date()) {
  if (!order) return true;
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') return true;
  if (order.status === 'PAID') return false;
  return now > new Date(order.hold_expires_at);
}

/**
 * Áp một khoản tiền vào đơn.
 * @param {object} order  Đơn hàng hiện tại
 * @param {number} amount Số tiền của giao dịch này (VND)
 * @param {Date}   now
 * @returns {{ result: string, updates: object|null, refund: {amount:number, reason:string}|null, note: string }}
 *   result ∈ OK | SHORT | EXCESS | LATE | DUPLICATE | IGNORED
 */
function applyPayment(order, amount, now = new Date()) {
  amount = Number(amount || 0);
  if (!(amount > 0)) {
    return { result: 'IGNORED', updates: null, refund: null, note: 'Số tiền không hợp lệ (<= 0)' };
  }

  const total = Number(order.total || 0);
  const prevPaid = Number(order.paid_amount || 0);
  const newPaid = prevPaid + amount;

  // Đơn đã thanh toán xong mà lại nhận thêm tiền -> hoàn toàn bộ khoản mới
  if (order.status === 'PAID') {
    return {
      result: 'DUPLICATE',
      updates: { paid_amount: newPaid },
      refund: { amount, reason: 'DUPLICATE' },
      note: 'Đơn đã thanh toán trước đó, hoàn lại toàn bộ khoản chuyển thêm'
    };
  }

  // Quá hạn giữ ghế: không xuất vé, hoàn 100% khoản này
  // (khoản trả thiếu trước đó, nếu có, đã được lập hồ sơ hoàn khi đơn chuyển EXPIRED)
  if (isHoldExpired(order, now)) {
    return {
      result: 'LATE',
      updates: { paid_amount: newPaid, status: 'EXPIRED' },
      refund: { amount, reason: 'LATE' },
      note: 'Nhận tiền sau khi hết thời gian giữ ghế'
    };
  }

  if (newPaid < total) {
    return {
      result: 'SHORT',
      updates: { paid_amount: newPaid, status: 'PARTIAL' },
      refund: null,
      note: `Còn thiếu ${total - newPaid}`
    };
  }

  const paidAt = now.toISOString();
  if (newPaid > total) {
    return {
      result: 'EXCESS',
      updates: { paid_amount: newPaid, status: 'PAID', paid_at: paidAt },
      refund: { amount: newPaid - total, reason: 'EXCESS' },
      note: `Thừa ${newPaid - total}`
    };
  }

  return {
    result: 'OK',
    updates: { paid_amount: newPaid, status: 'PAID', paid_at: paidAt },
    refund: null,
    note: 'Thanh toán đủ'
  };
}

// Tách mã đơn từ trường code hoặc nội dung chuyển khoản (BC... của Beta Cinemas, DH... của SePay test)
function extractOrderCode(body = {}) {
  const direct = String(body.code || '').trim().toUpperCase();
  if (/^(BC|DH)\d{6,12}$/.test(direct)) return direct;
  const match = String(body.content || '').match(/(BC|DH)\s*(\d{6,12})/i);
  return match ? (match[1] + match[2]).toUpperCase() : null;
}

module.exports = { applyPayment, isHoldExpired, extractOrderCode };
