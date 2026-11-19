// lib/routes/member.js (phục vụ tại /api/member) - Beta Club & đánh giá phim (Đợt 2)
//   GET  ?action=points                         điểm, hạng, lịch sử điểm của thành viên đăng nhập
//   GET  ?action=reviews&movie=<id>             đánh giá công khai của phim (không cần đăng nhập)
//   GET  ?action=review_stats                   điểm trung bình mọi phim
//   GET  ?action=can_review&movie=<id>          các đơn đã soát vé, chưa đánh giá (đăng nhập)
//   POST ?action=review { order_code, rating, content }
//   GET  ?action=watch&movie=<id>               đã bật "Nhắc tôi khi mở bán" chưa
//   POST ?action=watch { movie, on }             bật / tắt nhắc khi phim có suất chiếu (Đợt 3)
//   GET  ?action=favorites                       phim yêu thích (Đợt 5)
//   POST ?action=favorite { movie, on }          thêm / bỏ phim yêu thích
//   GET  ?action=history                         phim đã xem (đơn đã soát vé) + đánh giá của mình
const Auth = require('../auth');
const Points = require('../points');
const Reviews = require('../reviews');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const action = clean(q.action);
  try {
    if (req.method === 'GET' && action === 'reviews') {
      return res.status(200).json({ ok: true, ...(await Reviews.list(clean(q.movie), { limit: Number(q.limit) || 20 })) });
    }
    if (req.method === 'GET' && action === 'review_stats') return res.status(200).json({ ok: true, stats: await Reviews.stats() });

    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập' });
    if (req.method === 'GET' && action === 'points') return res.status(200).json({ ok: true, ...(await Points.overview(me)) });
    if (req.method === 'GET' && action === 'can_review') return res.status(200).json({ ok: true, orders: await Reviews.eligible(me, clean(q.movie)) });
    if (action === 'watch') {
      const Store = require('../store');
      const movie = clean(req.method === 'GET' ? q.movie : (req.body || {}).movie);
      if (!(await Store.one('movies', { id: movie }))) return res.status(404).json({ ok: false, error: 'Phim không tồn tại' });
      if (req.method === 'POST') {
        const on = (req.body || {}).on !== false;
        if (on) { try { await Store.insert('movie_watches', { customer_id: me.id, movie_id: movie, notified_at: null }); } catch (e) { if (e.code !== '23505') throw e; await Store.update('movie_watches', { customer_id: me.id, movie_id: movie }, { notified_at: null }); } }
        else await Store.remove('movie_watches', { customer_id: me.id, movie_id: movie });
      }
      const w = await Store.one('movie_watches', { customer_id: me.id, movie_id: movie });
      return res.status(200).json({ ok: true, watching: !!(w && !w.notified_at) });
    }
    // Phim yêu thích & lịch sử xem (Đợt 5)
    if (action === 'favorite' || action === 'favorites') {
      const Store = require('../store');
      const CatalogDB = require('../catalog-db');
      if (req.method === 'POST') {
        const b = req.body || {};
        const movie = clean(b.movie);
        if (!(await Store.one('movies', { id: movie }))) return res.status(404).json({ ok: false, error: 'Phim không tồn tại' });
        if (b.on === false) await Store.remove('favorites', { customer_id: me.id, movie_id: movie });
        else { try { await Store.insert('favorites', { customer_id: me.id, movie_id: movie }); } catch (e) { if (e.code !== '23505') throw e; } }
      }
      const favs = await Store.find('favorites', { customer_id: me.id }, { limit: 200 });
      const all = Object.fromEntries((await CatalogDB.movies()).map(m => [m.key, m]));
      return res.status(200).json({ ok: true, favorites: favs.map(f => all[f.movie_id]).filter(Boolean).map(m => ({ key: m.key, title: m.title, poster: m.poster, status: m.status, age: m.age })) });
    }
    if (req.method === 'GET' && action === 'history') {
      const Store = require('../store');
      const orders = await Store.find('orders', { user_id: me.id, status: { in: ['CONFIRMED', 'CONFIRMED_LATE'] } }, { limit: 200 });
      const out = [];
      for (const o of orders) {
        if ((o.kind || 'TICKET') !== 'TICKET') continue;
        const ck = await Store.one('ticket_checkins', { order_id: o.id });
        if (!ck) continue;
        const mv = await Store.one('movies', { id: o.movie_key });
        const rv = await Store.one('movie_reviews', { order_code: o.code });
        out.push({ order_code: o.code, movie_key: o.movie_key, title: mv ? mv.title : o.movie_key, poster: mv ? mv.poster : null, cinema: o.cinema, show_date: o.show_date, show_time: o.show_time, watched_at: ck.created_at, my_rating: rv ? rv.rating : null });
      }
      out.sort((a, b) => String(b.watched_at).localeCompare(String(a.watched_at)));
      return res.status(200).json({ ok: true, history: out });
    }
    if (req.method === 'POST' && action === 'review') return res.status(200).json({ ok: true, review: await Reviews.create(me, req.body || {}) });
    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
