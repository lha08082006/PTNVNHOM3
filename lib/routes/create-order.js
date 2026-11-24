// lib/routes/create-order.js (phục vụ tại /api/create-order) - Tạo đơn PENDING, khóa ghế nguyên tử 10 phút (bắt đầu Tầng 1)
// Bắt buộc đăng nhập: đơn gắn với thành viên, thông tin liên hệ lấy từ hồ sơ (không tin trình duyệt).
// Phim / rạp / giờ chiếu / giá ghế lấy từ suất chiếu trong database (showtime_id), không tin trình duyệt.
//   POST { showtime_id, seats, combos?, ticket_types?, voucher?, points?, total? }   đơn vé
//   POST { kind: 'FNB', cinema_id, combos, voucher?, points?, total? }              đơn chỉ mua bắp nước (Đợt 2)
// points: số điểm Beta Club muốn dùng (1 điểm = 1.000 đ, tối đa 50% giá trị đơn) – máy chủ kiểm tra số dư.
const Flow = require('../flow');
const Auth = require('../auth');
const Store = require('../store');
const CatalogDB = require('../catalog-db');
const { fail, clean } = require('../api-util');

const STOP_SALE_MS = 0; // ngừng bán khi suất bắt đầu chiếu
const points = (b) => Math.max(0, Math.floor(Number(b.points) || 0));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để đặt vé' });
    const b = req.body || {};
    const v = b.voucher ? await CatalogDB.checkVoucher(b.voucher, me.id) : null;
    const contact = { total: b.total, user_id: me.id, phone: me.phone, email: me.email, customer_name: me.full_name, points: points(b) };

    if (String(b.kind || '').toUpperCase() === 'FNB') {
      const cinema = await Store.one('cinemas', { id: clean(b.cinema_id) });
      if (!cinema || cinema.active === false) return res.status(400).json({ ok: false, error: 'Vui lòng chọn rạp nhận bắp nước' });
      const order = await Flow.createOrder({
        kind: 'FNB', cinema: cinema.name, showtime_key: 'FNB:' + cinema.id, movie_key: '', show_date: '', show_time: '', show_at: null,
        combos: b.combos, voucher: v ? v.code : null, voucher_def: v, ...contact,
        show_dow: new Date(Date.now() + 7 * 3600e3).getUTCDay() // voucher theo thứ: tính theo ngày mua
      });
      return res.status(200).json(await Flow.view(order));
    }

    const st = await CatalogDB.getShowtime(clean(b.showtime_id));
    if (!st || !st.active) return res.status(400).json({ ok: false, error: 'Suất chiếu không tồn tại hoặc đã ngừng bán' });
    if (new Date(st.starts_at).getTime() - STOP_SALE_MS <= Date.now()) return res.status(400).json({ ok: false, error: 'Suất chiếu đã bắt đầu, vui lòng chọn suất khác' });
    const pr = await CatalogDB.pricing();
    // Phim từ T13 trở lên không bán vé Trẻ em (trang chọn ghế đã ẩn, ở đây chặn lần nữa)
    const types = CatalogDB.typesForMovie(pr.types, st.movie);
    if (pr.types.CHILD && !types.CHILD && Number((b.ticket_types || {}).CHILD) > 0) return res.status(400).json({ ok: false, error: CatalogDB.childBlockedMsg(st.movie) });

    const order = await Flow.createOrder({
      movie_key: st.movie_key, cinema: st.cinema, show_date: st.date_label, show_time: st.time, show_at: st.starts_at,
      showtime_key: st.id, prices: st.prices, trusted_movie: true, layout: st.layout,
      seats: b.seats, combos: b.combos, voucher: v ? v.code : null, voucher_def: v,
      ticket_types: b.ticket_types || {}, types,
      show_dow: new Date(new Date(st.starts_at).getTime() + 7 * 3600e3).getUTCDay(),
      ...contact
    });
    return res.status(200).json(await Flow.view(order));
  } catch (e) {
    return fail(res, e);
  }
};
