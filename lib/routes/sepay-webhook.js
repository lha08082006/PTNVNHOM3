// lib/routes/sepay-webhook.js (phục vụ tại /api/sepay-webhook) - Webhook SePay (đường xác nhận nhanh của Tầng 1)
// - Idempotent theo mã giao dịch ngân hàng (referenceCode): webhook gửi lại không bị xử lý trùng.
// - Chỉ ghép tiền vào đơn khi nội dung chứa đúng mã đơn BCxxxxxxxxxx (BR-01). Tiền không khớp
//   đơn nào được đưa vào hàng đợi CSKH, KHÔNG tự ghép vào "đơn đang chờ gần nhất".
// - SePay phải gửi header "Authorization: Apikey <SEPAY_WEBHOOK_KEY>". Khi chạy với Supabase thật
//   mà chưa đặt khóa, webhook bị từ chối (nếu không, ai cũng gửi được "tiền vào" giả để lấy vé).
const crypto = require('crypto');
const Store = require('../store');
const Flow = require('../flow');
const { fail } = require('../api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const key = process.env.SEPAY_WEBHOOK_KEY;
  if (!key && Store.isLive()) {
    console.error('[sepay-webhook] Chưa cấu hình SEPAY_WEBHOOK_KEY – từ chối webhook');
    return res.status(503).json({ success: false, error: 'Chưa cấu hình SEPAY_WEBHOOK_KEY trên máy chủ' });
  }
  if (key) {
    const got = Buffer.from(String((req.headers && req.headers.authorization) || '').replace(/^Apikey\s+/i, ''));
    const want = Buffer.from(key);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      return res.status(401).json({ success: false, error: 'Sai khóa webhook' });
    }
  }
  try {
    const r = await Flow.handleIncomingTransfer(req.body || {});
    return res.status(200).json({ success: true, ...r });
  } catch (e) {
    return fail(res, e);
  }
};
