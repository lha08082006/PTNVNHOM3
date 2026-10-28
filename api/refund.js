// api/refund.js - Tiếp nhận và tra cứu hồ sơ hoàn tiền
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  // GET: Tra cứu tiến trình hoàn tiền
  if (req.method === 'GET') {
    try {
      const code = req.query.code;
      const orderCode = req.query.order_code || req.query.order;

      const refund = await DB.getRefund({ code, order_code: orderCode });
      if (!refund) {
        return res.status(404).json({ error: 'Không tìm thấy hồ sơ hoàn tiền' });
      }

      let order = null;
      if (refund.order_id) {
        order = await DB.getOrderByCode(orderCode);
      }

      return res.status(200).json({
        ok: true,
        refund: refund,
        order: order || null
      });
    } catch (error) {
      console.error('[API get-refund Error]:', error);
      return res.status(500).json({ error: error.message || 'Lỗi tra cứu hoàn tiền' });
    }
  }

  // POST: Gửi thông tin tài khoản ngân hàng để nhận hoàn tiền
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const orderCode = (body.order_code || body.order || '').trim();
      const refundCode = (body.code || body.refund_code || '').trim();
      const bankName = body.bank_name || body.bank;
      const accNumber = body.acc_number || body.acc;
      const accName = body.acc_name || body.owner;

      if (!bankName || !accNumber || !accName) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ ngân hàng, số tài khoản và tên chủ tài khoản' });
      }

      let targetRefund = null;
      if (refundCode) {
        targetRefund = await DB.getRefund({ code: refundCode });
      } else if (orderCode) {
        targetRefund = await DB.getRefund({ order_code: orderCode });
        // Nếu chưa có hồ sơ hoàn tiền cho đơn này -> tự động tạo
        if (!targetRefund) {
          const ord = await DB.getOrderByCode(orderCode);
          if (ord) {
            targetRefund = await DB.createRefund({
              order_id: ord.id,
              amount: ord.paid_amount || ord.total || 179000,
              reason: 'LATE',
              status: 'WAITING_INFO'
            });
          }
        }
      }

      if (!targetRefund) {
        return res.status(404).json({ error: 'Không tìm thấy hồ sơ hoàn tiền tương ứng' });
      }

      // Cập nhật thông tin ngân hàng và chuyển trạng thái sang RECEIVED (Đã tiếp nhận)
      const updated = await DB.updateRefund(targetRefund.code, {
        bank_name: bankName,
        acc_number: accNumber,
        acc_name: accName.toUpperCase(),
        status: 'RECEIVED'
      });

      return res.status(200).json({
        ok: true,
        refund_code: updated.code,
        status: updated.status,
        amount: updated.amount,
        bank_name: updated.bank_name,
        acc_number: updated.acc_number,
        acc_name: updated.acc_name,
        message: 'Đã tiếp nhận thông tin hoàn tiền thành công!'
      });
    } catch (error) {
      console.error('[API submit-refund Error]:', error);
      return res.status(500).json({ error: error.message || 'Lỗi gửi yêu cầu hoàn tiền' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
