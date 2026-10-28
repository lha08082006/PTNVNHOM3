// api/order-status.js
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).json({ error: 'Thiếu mã đơn hàng (code)' });
    }

    const order = await DB.getOrderByCode(code);
    if (!order) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng #' + code });
    }

    // Kiểm tra hồ sơ hoàn tiền nếu có
    const refund = await DB.getRefund({ order_id: order.id, order_code: order.code });

    const total = Number(order.total || 0);
    const paid = Number(order.paid_amount || 0);

    return res.status(200).json({
      ok: true,
      id: order.id,
      code: order.code,
      status: order.status,
      total: total,
      paid_amount: paid,
      remaining_amount: Math.max(0, total - paid),
      excess_amount: Math.max(0, paid - total),
      hold_expires_at: order.hold_expires_at,
      paid_at: order.paid_at,
      movie_key: order.movie_key,
      cinema: order.cinema,
      show_date: order.show_date,
      show_time: order.show_time,
      seats: order.seats || [],
      combos: order.combos || {},
      refund: refund || null
    });
  } catch (error) {
    console.error('[API order-status Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi tra cứu đơn hàng' });
  }
};
