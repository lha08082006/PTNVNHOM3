// lib/movie-stats.js - Điểm khán giả và xếp hạng phim bán chạy 7 ngày cho trang chủ / trang phim (Đợt 9)
// - Điểm ★ chỉ công bố khi phim có đủ số lượt đánh giá (mặc định 3) để 1–2 đánh giá không quyết định điểm.
// - Xếp hạng tính theo số vé đã thanh toán trong 7 ngày gần nhất; KHÔNG trả số vé ra ngoài (số liệu kinh doanh),
//   chỉ trả thứ hạng 1..5.
// - Lưu tạm 5 phút trong bộ nhớ của tiến trình để trang chủ không đếm lại đơn hàng mỗi lượt xem.
const Store = require('./store');
const Reviews = require('./reviews');

const MIN_REVIEWS = Math.max(1, Number(process.env.MIN_REVIEWS_SHOW) || 3);
const TOP = 5;
const TTL = 5 * 60 * 1000;
const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];
let cache = null;

async function compute(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 864e5).toISOString();
  const orders = await Store.find('orders', { status: { in: PAID }, created_at: { gte: since } }, { order: null, limit: 50000 });
  const sold = {};
  for (const o of orders) {
    if ((o.kind || 'TICKET') !== 'TICKET' || !o.movie_key) continue;
    const n = Array.isArray(o.seats) ? o.seats.length : 0;
    if (n) sold[o.movie_key] = (sold[o.movie_key] || 0) + n;
  }
  const ranked = Object.keys(sold).sort((a, b) => sold[b] - sold[a] || a.localeCompare(b));
  const rv = await Reviews.stats();
  const out = {};
  for (const k of new Set([...ranked, ...Object.keys(rv)])) {
    const r = rv[k];
    const i = ranked.indexOf(k);
    out[k] = {
      avg: r && r.count >= MIN_REVIEWS ? r.avg : null,
      count: r ? r.count : 0,
      rank: i > -1 && i < TOP ? i + 1 : null
    };
  }
  return { stats: out, top: ranked.slice(0, TOP), min_reviews: MIN_REVIEWS };
}

async function get() {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  const data = await compute();
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { get, compute, MIN_REVIEWS, _reset: () => { cache = null; } };
