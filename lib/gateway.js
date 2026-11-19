// lib/gateway.js - Bộ chuyển đổi "API Cổng Thanh Toán" (Query Status / Cancel Order / Refund)
//
// Nguồn xác nhận trạng thái giao dịch là SỔ CÁI bank_transactions:
//   - Webhook SePay ghi vào sổ cái ngay khi tiền về (đường nhanh).
//   - Query Status còn chủ động gọi API SePay (nếu có SEPAY_API_KEY) để bắt các giao dịch mà
//     webhook bị thất lạc, rồi bổ sung vào sổ cái (đường dự phòng).
// Refund API: VietQR là chuyển khoản một chiều nên không có "lệnh hoàn" thật như thẻ.
// Ở đây là SANDBOX mô phỏng lệnh chi hoàn về tài khoản nguồn (không chuyển tiền thật).
require('dotenv').config();
const Store = require('./store');

const SEPAY_API_KEY = process.env.SEPAY_API_KEY || '';
const SEPAY_ACCOUNT = process.env.SEPAY_ACCOUNT_NUMBER || '';

function extractOrderCode(text) {
  const m = String(text || '').toUpperCase().match(/\b(BC|DH)\s?(\d{10})\b/);
  return m ? m[1] + m[2] : null;
}

// Gọi API SePay liệt kê giao dịch gần nhất; giao dịch nào chưa có trong sổ cái thì bổ sung.
async function pullFromSepay(orderCode) {
  if (!SEPAY_API_KEY || !Store.isLive()) return { pulled: 0 };
  const qs = new URLSearchParams({ limit: '50' });
  if (SEPAY_ACCOUNT) qs.set('account_number', SEPAY_ACCOUNT);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch('https://my.sepay.vn/userapi/transactions/list?' + qs, {
      headers: { Authorization: 'Bearer ' + SEPAY_API_KEY, 'Content-Type': 'application/json' },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('SePay HTTP ' + r.status);
    const j = await r.json();
    let pulled = 0;
    for (const tx of j.transactions || []) {
      const code = extractOrderCode(tx.transaction_content);
      if (code !== orderCode || Number(tx.amount_in || 0) <= 0) continue;
      const ref = tx.reference_number || ('SEPAY-' + tx.id);
      const exists = await Store.one('bank_transactions', { reference_code: ref });
      if (exists) continue;
      await Store.insert('bank_transactions', {
        id: Number(tx.id) || Date.now(),
        gateway: tx.bank_brand_name || 'SePay',
        account_number: tx.account_number,
        transaction_date: new Date((tx.transaction_date || '').replace(' ', 'T') + '+07:00').toISOString(),
        content: tx.transaction_content,
        code,
        transfer_type: 'in',
        amount: Number(tx.amount_in),
        reference_code: ref,
        raw: tx,
        result: 'PULLED',
        note: 'Bổ sung từ API tra cứu SePay (webhook không về)'
      });
      pulled++;
    }
    return { pulled };
  } finally {
    clearTimeout(t);
  }
}

const Gateway = {
  extractOrderCode,

  // Trả về { status: 'SUCCESS' | 'PENDING' | 'NOT_FOUND', amount, txs, firstTxAt, lastTxAt }
  async queryStatus(order, now = new Date()) {
    let pullError = null;
    try { await pullFromSepay(order.code); } catch (e) { pullError = e.message; }

    const all = await Store.find('bank_transactions', { code: order.code, transfer_type: 'in' }, { order: 'transaction_date', asc: true });
    // Giao dịch ngân hàng đang xử lý (sandbox: chưa tới visible_at) -> cổng báo PENDING
    const settled = all.filter(t => !(t.raw && t.raw.visible_at && new Date(t.raw.visible_at) > now));
    const pending = all.length > settled.length;
    const amount = settled.reduce((s, t) => s + Number(t.amount || 0), 0);

    if (pullError && !settled.length) {
      const e = new Error('Query Status API lỗi: ' + pullError);
      e.gateway = true;
      throw e;
    }
    return {
      status: settled.length ? 'SUCCESS' : (pending ? 'PENDING' : 'NOT_FOUND'),
      amount,
      txs: settled,
      firstTxAt: settled[0] ? settled[0].transaction_date : null,
      lastTxAt: settled.length ? settled[settled.length - 1].transaction_date : null
    };
  },

  // Cancel Order API: VietQR không có phiên để hủy -> vô hiệu mã QR phía Beta (đơn không còn PENDING)
  async cancelOrder(order) {
    return { ok: true, note: 'Đã vô hiệu mã VietQR của đơn ' + order.code };
  },

  // Refund API (sandbox). idempotencyKey bảo đảm một lệnh không bị chi hai lần.
  async refund({ refund, order, source }) {
    // Đơn trả qua VNPay / MoMo / ZaloPay (Đợt 4): hoàn về đúng ví / thẻ qua API của cổng đó
    const viaProvider = await require('./payments').refundFor(refund);
    if (viaProvider) return viaProvider;
    const sb = (order && order.sandbox) || {};
    const failTimes = Number(sb.refund_fail_times || 0);
    if (!source || !source.acc_number) {
      return { ok: false, error: 'Không truy xuất được tài khoản nguồn từ giao dịch chuyển khoản' };
    }
    if (failTimes > Number(refund.attempts || 0)) {
      return { ok: false, error: 'Refund API trả FAILED/timeout (sandbox)' };
    }
    return {
      ok: true,
      ref: 'RF' + Date.now().toString().slice(-9),
      note: `Đã gửi lệnh hoàn ${refund.amount}đ về ${source.bank_name || ''} ${source.acc_number} (sandbox, idempotencyKey=${refund.idempotency_key})`
    };
  }
};

module.exports = Gateway;
