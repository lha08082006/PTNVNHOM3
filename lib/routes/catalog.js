// lib/routes/catalog.js (phục vụ tại /api/catalog) - Danh mục công khai cho website khách
//   GET ?action=movies                              phim đang chiếu / sắp chiếu
//   GET ?action=cinemas                             cụm rạp
//   GET ?action=showtimes&cinema=&date=&movie=&days= suất chiếu (ngày YYYY-MM-DD, giờ VN) kèm số ghế trống
//   GET ?action=showtime&id=                        một suất chiếu (phim, rạp, giá ghế)
//   GET ?action=voucher&code=                       kiểm tra mã giảm giá (theo thành viên đang đăng nhập)
//   GET ?action=posts&type=&movie=&cinema=           tin tức & ưu đãi đang hiển thị
//   GET ?action=post&id=                            một bài
//   GET ?action=pricing                             bảng giá: loại vé, quy tắc giá theo ngày/khung giờ, ngày lễ sắp tới
const CatalogDB = require('../catalog-db');
const Auth = require('../auth');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  const q = req.query || {};
  const action = clean(q.action);
  try {
    if (action === 'posts') {
      const Posts = require('../posts');
      const type = ['PROMO', 'NEWS', 'EVENT'].includes(clean(q.type).toUpperCase()) ? clean(q.type).toUpperCase() : undefined;
      return res.status(200).json({ ok: true, types: Posts.TYPES, posts: await Posts.list({ type, movie: clean(q.movie) || undefined, cinema: clean(q.cinema) || undefined, limit: Math.min(50, Number(q.limit) || 30) }) });
    }
    if (action === 'post') {
      const p = await require('../posts').get(clean(q.id));
      if (!p) return res.status(404).json({ ok: false, error: 'Bài viết không tồn tại hoặc đã hết hạn' });
      return res.status(200).json({ ok: true, post: p });
    }
    if (action === 'pricing') {
      const pr = await CatalogDB.pricing();
      const today = CatalogDB.vnToday();
      return res.status(200).json({
        ok: true, ticket_types: pr.types, default_prices: require('../../catalog').SEAT_PRICES,
        rules: pr.rules.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(r => ({
          name: r.name, days: r.days || [], holiday: !!r.holiday, start_time: r.start_time, end_time: r.end_time,
          price_standard: r.price_standard || null, price_vip: r.price_vip || null, price_sweetbox: r.price_sweetbox || null
        })),
        holidays: [...pr.holidays.entries()].filter(([d]) => d >= today).sort().slice(0, 20).map(([date, name]) => ({ date, name }))
      });
    }
    if (action === 'movies') return res.status(200).json({ ok: true, movies: await CatalogDB.movies() });
    if (action === 'cinemas') return res.status(200).json({ ok: true, cinemas: await CatalogDB.cinemas() });
    if (action === 'showtimes') {
      const days = Math.min(31, Math.max(1, Number(q.days) || 1)); // Đợt 3: mở bán trước tới 30 ngày
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
