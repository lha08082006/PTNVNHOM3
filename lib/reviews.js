// lib/reviews.js - Đánh giá phim (Đợt 2): CHỈ khách đã được soát vé vào rạp mới đánh giá được,
// mỗi đơn vé một đánh giá -> không có đánh giá ảo. Quản lý / CSKH ẩn được đánh giá vi phạm.
const Store = require('./store');
const Ticket = require('./ticket');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];
// Tên hiển thị gọn: "Nguyễn Văn An" -> "An N."
const shortName = (full) => {
  const p = String(full || 'Khách').trim().split(/\s+/);
  return p.length > 1 ? `${p[p.length - 1]} ${p[0][0]}.` : p[0];
};
const pub = (r) => ({ id: r.id, rating: r.rating, content: r.content || '', name: r.customer_name, created_at: r.created_at, verified: true });

// Các đơn đã soát vé của khách cho phim này mà chưa đánh giá
async function eligible(customer, movieId) {
  const orders = await Store.find('orders', { user_id: customer.id, movie_key: movieId, status: { in: PAID } }, { limit: 50 });
  const out = [];
  for (const o of orders) {
    if (!(await Ticket.lastCheckin(o.id))) continue;
    if (await Store.one('movie_reviews', { order_code: o.code })) continue;
    out.push({ order_code: o.code, cinema: o.cinema, show_date: o.show_date, show_time: o.show_time });
  }
  return out;
}

async function create(customer, { order_code, rating, content }) {
  const o = await Store.one('orders', { code: String(order_code || '').trim().toUpperCase() });
  if (!o || o.user_id !== customer.id) throw httpError('Không tìm thấy đơn vé của bạn', 404);
  if (!PAID.includes(o.status) || (o.kind && o.kind !== 'TICKET')) throw httpError('Đơn này không phải vé xem phim đã thanh toán', 400);
  if (!(await Ticket.lastCheckin(o.id))) throw httpError('Bạn chỉ đánh giá được sau khi đã soát vé vào rạp xem phim này', 403);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw httpError('Chọn số sao từ 1 đến 5', 400);
  const text = String(content || '').replace(/\s+\n/g, '\n').trim().slice(0, 1000);
  try {
    return pub(await Store.insert('movie_reviews', {
      movie_id: o.movie_key, customer_id: customer.id, customer_name: shortName(customer.full_name),
      order_code: o.code, rating: r, content: text, hidden: false
    }));
  } catch (e) {
    if (e.code === '23505') throw httpError('Bạn đã đánh giá phim này cho đơn ' + o.code, 409);
    throw e;
  }
}

async function list(movieId, { limit = 20 } = {}) {
  const rows = (await Store.find('movie_reviews', { movie_id: movieId, hidden: false }, { limit: 2000 }));
  const dist = [0, 0, 0, 0, 0];
  rows.forEach(r => { dist[r.rating - 1]++; });
  const count = rows.length;
  const avg = count ? Math.round(rows.reduce((s, r) => s + r.rating, 0) / count * 10) / 10 : null;
  return { count, avg, dist, reviews: rows.slice(0, Math.min(50, limit)).map(pub) };
}

// Điểm trung bình của mọi phim (cho danh sách phim)
async function stats() {
  const rows = await Store.find('movie_reviews', { hidden: false }, { limit: 20000, order: null });
  const m = {};
  rows.forEach(r => { (m[r.movie_id] = m[r.movie_id] || { sum: 0, count: 0 }); m[r.movie_id].sum += r.rating; m[r.movie_id].count++; });
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { count: v.count, avg: Math.round(v.sum / v.count * 10) / 10 }]));
}

// Nội bộ
async function adminList({ movie, hidden } = {}) {
  const f = {};
  if (movie) f.movie_id = movie;
  if (hidden === 'true' || hidden === true) f.hidden = true;
  return Store.find('movie_reviews', f, { limit: 200 });
}
async function setHidden(id, hidden, staff) {
  const [r] = await Store.update('movie_reviews', { id }, { hidden: !!hidden, moderated_by: staff ? staff.full_name : null, moderated_at: new Date().toISOString() });
  if (!r) throw httpError('Không tìm thấy đánh giá', 404);
  return r;
}

module.exports = { eligible, create, list, stats, adminList, setHidden, shortName };
