// api/create-order.js
const DB = require('../lib/db');
const { priceOrder } = require('../lib/pricing');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    // Server tự tính tiền từ ghế + combo; không dùng thẳng số tiền trình duyệt gửi
    const price = priceOrder({ seats: body.seats, combos: body.combos, total: body.total });
    if (!price.ok) {
      return res.status(400).json({ error: price.error });
    }

    const order = await DB.createOrder({
      movie_key: body.movie_key,
      cinema: body.cinema,
      show_date: body.show_date,
      show_time: body.show_time,
      seats: price.seats,
      combos: body.combos || {},
      voucher: price.discount > 0 ? (body.voucher || null) : null,
      total: price.total,
      phone: body.phone || null
    });

    return res.status(200).json({
      ok: true,
      id: order.id,
      code: order.code,
      total: order.total,
      hold_expires_at: order.hold_expires_at
    });
  } catch (error) {
    console.error('[API create-order Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi tạo đơn hàng' });
  }
};
