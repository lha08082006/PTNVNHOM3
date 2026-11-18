// api/create-order.js - Tạo đơn PENDING, khóa ghế nguyên tử 10 phút (bắt đầu Tầng 1)
// Bắt buộc đăng nhập: đơn gắn với thành viên, thông tin liên hệ lấy từ hồ sơ (không tin trình duyệt).
const Flow = require('../lib/flow');
const Auth = require('../lib/auth');
const { fail } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để đặt vé' });
    const b = req.body || {};
    const order = await Flow.createOrder({
      movie_key: b.movie_key, cinema: b.cinema, show_date: b.show_date, show_time: b.show_time,
      showtime_key: b.showtime_key, seats: b.seats, combos: b.combos, voucher: b.voucher,
      total: b.total, user_id: me.id, phone: me.phone, email: me.email, customer_name: me.full_name
    });
    return res.status(200).json(await Flow.view(order));
  } catch (e) {
    return fail(res, e);
  }
};
