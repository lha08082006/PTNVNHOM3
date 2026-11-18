// api/sepay-webhook.js - Webhook SePay (đường xác nhận nhanh của Tầng 1)
// - Idempotent theo mã giao dịch ngân hàng (referenceCode): webhook gửi lại không bị xử lý trùng.
// - Chỉ ghép tiền vào đơn khi nội dung chứa đúng mã đơn BCxxxxxxxxxx (BR-01). Tiền không khớp
//   đơn nào được đưa vào hàng đợi CSKH, KHÔNG tự ghép vào "đơn đang chờ gần nhất".
// - Nếu đặt SEPAY_WEBHOOK_KEY, SePay phải gửi header "Authorization: Apikey <khóa>".
const Flow = require('../lib/flow');
const { fail } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const key = process.env.SEPAY_WEBHOOK_KEY;
  if (key) {
    const auth = String((req.headers && req.headers.authorization) || '');
    if (auth.replace(/^Apikey\s+/i, '') !== key) return res.status(401).json({ success: false, error: 'Sai khóa webhook' });
  }
  try {
    const r = await Flow.handleIncomingTransfer(req.body || {});
    return res.status(200).json({ success: true, ...r });
  } catch (e) {
    return fail(res, e);
  }
};
