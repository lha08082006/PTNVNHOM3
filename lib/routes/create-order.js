// lib/routes/create-order.js (phục vụ tại /api/create-order) - Tạo đơn PENDING, khóa ghế nguyên tử 10 phút (bắt đầu Tầng 1)
// Bắt buộc đăng nhập: đơn gắn với thành viên, thông tin liên hệ lấy từ hồ sơ (không tin trình duyệt).
// Phim / rạp / giờ chiếu / giá ghế lấy từ suất chiếu trong database (showtime_id), không tin trình duyệt.
const Flow = require('../flow');
const Auth = require('../auth');
const CatalogDB = require('../catalog-db');
const { fail, clean } = require('../api-util');

const STOP_SALE_MS = 0; // ngừng bán khi suất bắt đầu chiếu

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để đặt vé' });
    const b = req.body || {};
    const st = await CatalogDB.getShowtime(clean(b.showtime_id));
    if (!st || !st.active) return res.status(400).json({ ok: false, error: 'Suất chiếu không tồn tại hoặc đã ngừng bán' });
    if (new Date(st.starts_at).getTime() - STOP_SALE_MS <= Date.now()) return res.status(400).json({ ok: false, error: 'Suất chiếu đã bắt đầu, vui lòng chọn suất khác' });
    const v = b.voucher ? await CatalogDB.checkVoucher(b.voucher, me.id) : null;
    const pr = await CatalogDB.pricing();

    const order = await Flow.createOrder({
      movie_key: st.movie_key, cinema: st.cinema, show_date: st.date_label, show_time: st.time, show_at: st.starts_at,
      showtime_key: st.id, prices: st.prices, trusted_movie: true,
      seats: b.seats, combos: b.combos, voucher: v ? v.code : null, voucher_def: v,
      ticket_types: b.ticket_types || {}, types: pr.types,
      show_dow: new Date(new Date(st.starts_at).getTime() + 7 * 3600e3).getUTCDay(),
      total: b.total, user_id: me.id, phone: me.phone, email: me.email, customer_name: me.full_name
    });
    return res.status(200).json(await Flow.view(order));
  } catch (e) {
    return fail(res, e);
  }
};
