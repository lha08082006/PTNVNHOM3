// lib/routes/refund.js (phục vụ tại /api/refund) - Tra cứu hoàn tiền & RefundForm (BR-06, NFR-12, NFR-16)
// RefundForm chỉ mở khi hệ thống KHÔNG tự hoàn được (MANUAL_REVIEW): sau 24 giờ Refund API
// thất bại hoặc dữ liệu giao dịch mâu thuẫn. Bình thường khách không phải điền gì.
const Store = require('../store');
const Flow = require('../flow');
const Auth = require('../auth');
const Access = require('../access');
const { fail, clean } = require('../api-util');

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// NFR-12: chỉ nhận JPG/PNG <= 5MB, kiểm tra chữ ký tệp (magic bytes) thay vì tin phần mở rộng
function checkReceipt(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Ảnh biên lai phải là tệp JPG hoặc PNG'), { http: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_RECEIPT_BYTES) throw Object.assign(new Error('Ảnh biên lai vượt quá 5 MB'), { http: 400 });
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!(isJpg || isPng)) throw Object.assign(new Error('Tệp tải lên không phải ảnh JPG/PNG hợp lệ'), { http: 400 });
  return dataUrl;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      let order = null;
      if (clean(q.code).startsWith('REF-')) {
        const rf = await Store.one('refunds', { code: clean(q.code) });
        if (rf) order = await Store.one('orders', { id: rf.order_id });
      }
      if (!order) {
        const oc = clean(q.order_code || q.order || q.code).toUpperCase();
        if (oc) order = await Store.one('orders', { code: oc });
      }
      if (!order) return res.status(404).json({ error: 'Không tìm thấy hồ sơ hoàn tiền' });
      order = (await Flow.tick(order)) || order;
      return res.status(200).json(await Access.viewFor(req, order));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const orderCode = clean(b.order_code || b.order).toUpperCase();
      const bankName = clean(b.bank_name || b.bank).slice(0, 80);
      const accNumber = clean(b.acc_number || b.acc).replace(/\s+/g, '');
      const accName = clean(b.acc_name || b.owner).toUpperCase().slice(0, 80);
      if (!bankName || !accNumber || !accName) {
        return res.status(400).json({ error: 'Vui lòng điền đủ ngân hàng thụ hưởng, số tài khoản và tên chủ tài khoản' });
      }
      if (!/^\d{6,20}$/.test(accNumber)) return res.status(400).json({ error: 'Số tài khoản chỉ gồm 6–20 chữ số' });
      const receipt = checkReceipt(b.receipt);

      // Chỉ chủ đơn (đã đăng nhập) mới khai được tài khoản nhận hoàn tiền: mã đơn nằm trong nội dung
      // chuyển khoản nên người khác có thể biết, không được để họ khai tài khoản của mình để nhận tiền.
      const me = await Auth.currentCustomer(req);
      if (!me) return res.status(401).json({ error: 'Vui lòng đăng nhập đúng tài khoản đã đặt vé để gửi biểu mẫu hoàn tiền' });
      const order = orderCode ? await Store.one('orders', { code: orderCode }) : null;
      if (!order || order.user_id !== me.id) {
        return res.status(404).json({ error: 'Không tìm thấy đơn hàng #' + orderCode + ' trong tài khoản của bạn. Nếu đơn đặt trước khi có tài khoản, vui lòng gửi yêu cầu ở Trung tâm hỗ trợ.' });
      }
      const refunds = await Store.find('refunds', { order_code: order.code, status: 'MANUAL_REVIEW' });
      const rf = refunds[0];
      if (!rf) {
        return res.status(409).json({ error: 'Đơn này chưa cần điền biểu mẫu: hệ thống đang tự xử lý (cấp vé bù hoặc hoàn tiền tự động về tài khoản nguồn).' });
      }

      const now = new Date().toISOString();
      const rows = await Store.update('refunds', { id: rf.id, status: 'MANUAL_REVIEW' }, {
        status: 'FORM_SUBMITTED', bank_name: bankName, acc_number: accNumber, acc_name: accName,
        receipt_url: receipt, form_submitted_at: now, cs_note: null
      });
      const updated = rows[0];
      if (!updated) return res.status(409).json({ error: 'Biểu mẫu đã được gửi trước đó' });

      const after = await Flow.addHistory(order, 'Khách đã gửi RefundForm (thông tin ngân hàng + ảnh biên lai)');
      const tickets = await Store.find('support_tickets', { order_code: order.code, status: { neq: 'RESOLVED' } });
      const context = await Flow.buildContext(after, updated);
      if (tickets.length) {
        for (const t of tickets) await Store.update('support_tickets', { id: t.id }, { status: 'OPEN', context, updated_at: now });
      } else {
        await Flow.openTicket(after, { type: 'MANUAL_REVIEW', summary: 'Khách đã gửi RefundForm', refund: updated });
      }
      await Flow.notify(after, 'FORM_RECEIVED', 'Đã nhận biểu mẫu hoàn tiền',
        `Beta Cinemas đã nhận thông tin nhận hoàn tiền cho đơn ${order.code}. CSKH sẽ đối chiếu và chuyển Kế toán hoàn tiền trong 3–7 ngày làm việc.`);
      return res.status(200).json({ ...(await Flow.view(after)), refund_code: updated.code, message: 'Đã tiếp nhận biểu mẫu hoàn tiền' });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    return fail(res, e);
  }
};
