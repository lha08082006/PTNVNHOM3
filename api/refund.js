// api/refund.js - Tiếp nhận và tra cứu hồ sơ hoàn tiền
const DB = require('../lib/db');

// Che số tài khoản khi trả về để tránh lộ dữ liệu cá nhân: 0123456789 -> ******6789
function maskAccount(acc) {
  if (!acc) return acc;
  const s = String(acc);
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

function publicRefund(refund) {
  if (!refund) return null;
  const { orders, ...rest } = refund;
  return { ...rest, acc_number: maskAccount(rest.acc_number) };
}

module.exports = async function handler(req, res) {
  // GET: Tra cứu tiến trình hoàn tiền
  if (req.method === 'GET') {
    try {
      const code = (req.query.code || '').trim() || null;
      const orderCode = (req.query.order_code || req.query.order || '').trim().toUpperCase() || null;
      if (!code && !orderCode) {
        return res.status(400).json({ error: 'Thiếu mã hồ sơ (code) hoặc mã đơn (order_code)' });
      }

      const refund = await DB.getRefund({ code, order_code: orderCode });
      if (!refund) {
        return res.status(404).json({ error: 'Không tìm thấy hồ sơ hoàn tiền' });
      }

      const order = refund.order_id ? await DB.getOrderById(refund.order_id) : null;
      return res.status(200).json({
        ok: true,
        refund: publicRefund(refund),
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
      const orderCode = String(body.order_code || body.order || '').trim().toUpperCase();
      const refundCode = String(body.code || body.refund_code || '').trim();
      const bankName = String(body.bank_name || body.bank || '').trim();
      const accNumber = String(body.acc_number || body.acc || '').replace(/\s+/g, '');
      const accName = String(body.acc_name || body.owner || '').trim();

      if (!bankName || !accNumber || !accName) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ ngân hàng, số tài khoản và tên chủ tài khoản' });
      }
      if (!/^\d{6,20}$/.test(accNumber)) {
        return res.status(400).json({ error: 'Số tài khoản không hợp lệ (chỉ gồm 6-20 chữ số)' });
      }

      let targetRefund = null;
      if (refundCode) {
        targetRefund = await DB.getRefund({ code: refundCode });
      } else if (orderCode) {
        const ord = await DB.getOrderByCode(orderCode);
        if (ord) {
          targetRefund = await DB.getRefund({ order_id: ord.id });
          // Chỉ tự tạo hồ sơ khi đơn thực sự có tiền cần hoàn (đã nhận tiền nhưng không xuất vé)
          const paid = Number(ord.paid_amount || 0);
          if (!targetRefund && paid > 0 && (ord.status === 'EXPIRED' || ord.status === 'CANCELLED')) {
            targetRefund = await DB.createRefund({ order_id: ord.id, amount: paid, reason: 'LATE' });
          }
        }
      }

      if (!targetRefund) {
        return res.status(404).json({ error: 'Không tìm thấy hồ sơ hoàn tiền tương ứng' });
      }
      if (targetRefund.status !== 'WAITING_INFO' && targetRefund.status !== 'RECEIVED') {
        return res.status(409).json({ error: 'Hồ sơ đang được xử lý, không thể thay đổi thông tin tài khoản' });
      }

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
        acc_number: maskAccount(updated.acc_number),
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

module.exports.maskAccount = maskAccount;
