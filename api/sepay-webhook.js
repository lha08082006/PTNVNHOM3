// api/sepay-webhook.js - Webhook SePay VietQR: ghi sổ cái, xử lý đủ / thiếu / thừa / trễ / trùng
const crypto = require('crypto');
const DB = require('../lib/db');
const { applyPayment, extractOrderCode } = require('../lib/payment');

// SePay gửi header: Authorization: Apikey <SEPAY_API_KEY>
function verifyAuth(req) {
  const expected = process.env.SEPAY_API_KEY || '';
  if (!expected) {
    // Chưa cấu hình khóa: chỉ cho phép ngoài production (dev / demo local)
    return process.env.NODE_ENV === 'production'
      ? { ok: false, status: 503, error: 'Webhook chưa được cấu hình SEPAY_API_KEY' }
      : { ok: true };
  }
  const header = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = header.match(/^\s*apikey\s+(.+?)\s*$/i);
  const given = Buffer.from(m ? m[1] : '');
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

const RESULT_MESSAGES = {
  OK: 'Thanh toán đủ',
  SHORT: 'Thanh toán thiếu',
  EXCESS: 'Thanh toán thừa, đã lập hồ sơ hoàn phần thừa',
  LATE: 'Thanh toán sau khi hết hạn giữ ghế, đã lập hồ sơ hoàn 100%',
  DUPLICATE: 'Đơn đã thanh toán trước đó, đã lập hồ sơ hoàn khoản chuyển thêm',
  IGNORED: 'Bỏ qua giao dịch'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = verifyAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  let txId = null;
  let txSaved = false;
  try {
    const body = req.body || {};
    txId = Number(body.id);
    if (!Number.isSafeInteger(txId)) {
      return res.status(400).json({ success: false, error: 'Thiếu hoặc sai id giao dịch' });
    }

    const transferType = String(body.transferType || body.transfer_type || 'in').toLowerCase();
    const amount = Number(body.transferAmount != null ? body.transferAmount : body.amount || 0);
    const referenceCode = body.referenceCode || body.reference_code || null;
    const orderCode = extractOrderCode(body);

    // 1. Ghi sổ cái TRƯỚC khi xử lý: khóa chính id SePay đảm bảo mỗi giao dịch chỉ xử lý 1 lần
    try {
      await DB.insertBankTransaction({
        id: txId,
        gateway: body.gateway,
        account_number: body.accountNumber || body.account_number,
        transaction_date: body.transactionDate || body.transaction_date,
        content: body.content,
        code: orderCode,
        transfer_type: transferType,
        amount,
        reference_code: referenceCode,
        raw: body
      });
      txSaved = true;
    } catch (err) {
      if (err.code === 'DUPLICATE') {
        console.log('[SePay Webhook] Bỏ qua giao dịch đã xử lý:', txId);
        return res.status(200).json({ success: true, duplicate: true, message: 'Giao dịch đã được ghi nhận trước đó', code: orderCode });
      }
      throw err;
    }

    const finish = async (result, note, extra = {}) => {
      await DB.updateBankTransaction(txId, { result, note, ...(extra.order_id ? { order_id: extra.order_id } : {}) });
      return res.status(200).json({ success: true, code: orderCode, result, message: note, ...extra.response });
    };

    // 2. Chỉ xử lý tiền VÀO
    if (transferType !== 'in') {
      return finish('IGNORED', 'Giao dịch tiền ra, không xử lý');
    }

    // 3. Cùng mã tham chiếu ngân hàng nhưng khác id -> trùng, không cộng tiền
    if (referenceCode) {
      const sameRef = await DB.findBankTransaction({ reference_code: referenceCode, exclude_id: txId });
      if (sameRef) {
        return finish('DUPLICATE', 'Trùng mã tham chiếu ngân hàng với giao dịch ' + sameRef.id);
      }
    }

    // 4. Không xác định được đơn -> UNMATCHED, chờ đối soát (KHÔNG tự ghép / tự tạo đơn)
    if (!orderCode) {
      return finish('UNMATCHED', 'Không tìm thấy mã đơn BC... trong nội dung chuyển khoản');
    }
    const order = await DB.getOrderByCode(orderCode);
    if (!order) {
      return finish('UNMATCHED', 'Mã đơn ' + orderCode + ' không tồn tại');
    }

    // 5. Áp quy tắc thanh toán
    const outcome = applyPayment(order, amount);
    let updated = order;
    if (outcome.updates) updated = (await DB.updateOrder(order.id, outcome.updates)) || { ...order, ...outcome.updates };

    let refund = null;
    if (outcome.refund) {
      refund = await DB.createRefund({
        order_id: order.id,
        bank_tx_id: txId,
        amount: outcome.refund.amount,
        reason: outcome.refund.reason
      });
    }

    const total = Number(updated.total || 0);
    const paid = Number(updated.paid_amount || 0);
    console.log(`[SePay Webhook]: Đơn #${orderCode} | +${amount} | ${paid}/${total} | ${outcome.result}`);

    return finish(outcome.result, outcome.note || RESULT_MESSAGES[outcome.result], {
      order_id: order.id,
      response: {
        status: updated.status,
        paid_amount: paid,
        total,
        remaining_amount: Math.max(0, total - paid),
        refund: refund || null
      }
    });
  } catch (error) {
    console.error('[SePay Webhook Error]:', error);
    // Giao dịch đã vào sổ cái nhưng xử lý lỗi -> đánh dấu ERROR để BetaBot / nhân viên đối soát lại
    if (txSaved) {
      try {
        await DB.updateBankTransaction(txId, { result: 'ERROR', note: 'Lỗi xử lý: ' + (error.message || '') });
      } catch (e) { /* bỏ qua */ }
    }
    return res.status(500).json({ success: false, error: error.message || 'Lỗi xử lý webhook' });
  }
};

module.exports.verifyAuth = verifyAuth;
