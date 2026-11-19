// lib/routes/catalog.js (phục vụ tại /api/catalog) - Danh mục công khai cho website khách
//   GET ?action=movies                              phim đang chiếu / sắp chiếu
//   GET ?action=cinemas                             cụm rạp
//   GET ?action=showtimes&cinema=&date=&movie=&days= suất chiếu (ngày YYYY-MM-DD, giờ VN) kèm số ghế trống
//   GET ?action=showtime&id=                        một suất chiếu (phim, rạp, giá ghế)
//   GET ?action=voucher&code=                       kiểm tra mã giảm giá (theo thành viên đang đăng nhập)
const CatalogDB = require('../catalog-db');
const Auth = require('../auth');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  const q = req.query || {};
  const action = clean(q.action);
  try {
    if (action === 'movies') return res.status(200).json({ ok: true, movies: await CatalogDB.movies() });
    if (action === 'cinemas') return res.status(200).json({ ok: true, cinemas: await CatalogDB.cinemas() });
    if (action === 'showtimes') {
      const days = Math.min(14, Math.max(1, Number(q.days) || 1));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(q.date)) ? clean(q.date) : undefined;
      return res.status(200).json({ ok: true, today: CatalogDB.vnToday(), showtimes: await CatalogDB.showtimes({ cinema: clean(q.cinema) || undefined, movie: clean(q.movie) || undefined, date, days }) });
    }
    if (action === 'showtime') {
      const st = await CatalogDB.getShowtime(clean(q.id));
      if (!st) return res.status(404).json({ ok: false, error: 'Suất chiếu không tồn tại' });
      return res.status(200).json({ ok: true, showtime: st });
    }
    if (action === 'voucher') {
      const me = await Auth.currentCustomer(req);
      const v = await CatalogDB.checkVoucher(q.code, me && me.id);
      return res.status(200).json({ ok: true, voucher: v });
    }
    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
