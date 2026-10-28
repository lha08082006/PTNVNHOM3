// api/create-order.js
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    if (!body.total || body.total <= 0) {
      return res.status(400).json({ error: 'Số tiền đơn hàng không hợp lệ' });
    }

    const order = await DB.createOrder({
      movie_key: body.movie_key,
      cinema: body.cinema,
      show_date: body.show_date,
      show_time: body.show_time,
      seats: body.seats || [],
      combos: body.combos || {},
      voucher: body.voucher || null,
      total: body.total,
      phone: body.phone || '0987654321'
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
