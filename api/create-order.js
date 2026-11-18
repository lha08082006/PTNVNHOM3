// api/create-order.js - Tạo đơn PENDING, khóa ghế nguyên tử 10 phút (bắt đầu Tầng 1)
const Flow = require('../lib/flow');
const { fail } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const b = req.body || {};
    const order = await Flow.createOrder({
      movie_key: b.movie_key, cinema: b.cinema, show_date: b.show_date, show_time: b.show_time,
      showtime_key: b.showtime_key, seats: b.seats, combos: b.combos, voucher: b.voucher,
      total: b.total, phone: b.phone, email: b.email, customer_name: b.customer_name
    });
    return res.status(200).json(await Flow.view(order));
  } catch (e) {
    return fail(res, e);
  }
};
