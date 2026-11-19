// lib/catalog-db.js - Danh mục trong database: phim, rạp, suất chiếu, voucher (Quản lý sửa trên admin.html)
// catalog.js vẫn giữ giá mặc định, combo và dữ liệu khởi tạo; giá vé thực tế lấy theo từng suất chiếu.
const Store = require('./store');
const Catalog = require('../catalog');

const MIN = 60 * 1000;
const VN = 7 * 60 * MIN; // giờ Việt Nam (UTC+7)
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const pad = (n) => String(n).padStart(2, '0');

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "2026-11-19" + "20:00" (giờ VN) -> ISO
function vnIso(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t) throw httpError('Ngày/giờ không hợp lệ (YYYY-MM-DD, HH:MM)', 400);
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - VN).toISOString();
}
// ISO -> các nhãn hiển thị theo giờ VN
function vnParts(iso) {
  const v = new Date(new Date(iso).getTime() + VN);
  return {
    date: `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`,
    time: `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`,
    label: `${DOW[v.getUTCDay()]} ${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}`,
    late: v.getUTCHours() >= 22
  };
}
const vnToday = () => vnParts(new Date().toISOString()).date;
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

const MOVIE_STATUS = { NOW: 'Đang chiếu', SOON: 'Sắp chiếu', HIDDEN: 'Ẩn' };

const publicMovie = (m) => m && ({
  key: m.id, title: m.title, shortTitle: m.short_title || m.title, age: m.age || '', meta: m.meta || '',
  poster: m.poster || 'images/400x633-145627-230926-40.jpg', format: m.format || '2D', badge: m.badge || '2D',
  duration_min: m.duration_min || null, status: m.status || 'NOW', trailer: m.trailer || null
});

// ---------------------------------------------------------------------------
// Bảng giá: giá ghế theo ngày (thường / cuối tuần / lễ) và khung giờ, loại vé theo đối tượng
//   Giá một suất = giá mặc định (catalog.js)
//                -> lần lượt áp các quy tắc khớp ngày & giờ (priority thấp trước, cao sau; ô để trống = giữ giá cũ)
//                -> giá riêng của suất chiếu (Quản lý đặt khi tạo suất) nếu có
// ---------------------------------------------------------------------------
const DEFAULT_RULES = [
  { name: 'Ngày thường (T2–T5)', days: [1, 2, 3, 4], holiday: false, start_time: '00:00', end_time: '24:00', price_standard: 45000, price_vip: 50000, price_sweetbox: 100000, priority: 10 },
  { name: 'Cuối tuần (T6–CN)', days: [5, 6, 0], holiday: false, start_time: '00:00', end_time: '24:00', price_standard: 55000, price_vip: 60000, price_sweetbox: 120000, priority: 10 },
  { name: 'Ngày lễ, Tết', days: [], holiday: true, start_time: '00:00', end_time: '24:00', price_standard: 65000, price_vip: 70000, price_sweetbox: 140000, priority: 15 },
  { name: 'Suất sớm (trước 10:00)', days: [0, 1, 2, 3, 4, 5, 6], holiday: false, start_time: '00:00', end_time: '10:00', price_standard: 40000, price_vip: 45000, price_sweetbox: 90000, priority: 20 },
  { name: 'Suất khuya (từ 22:00)', days: [0, 1, 2, 3, 4, 5, 6], holiday: false, start_time: '22:00', end_time: '24:00', price_standard: 45000, price_vip: 50000, price_sweetbox: 100000, priority: 20 },
  { name: 'Thứ Ba vui vẻ', days: [2], holiday: false, start_time: '00:00', end_time: '24:00', price_standard: 40000, price_vip: 45000, price_sweetbox: 90000, priority: 30 }
];
const DOW_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// Đọc bảng giá một lần cho cả lượt tính (quy tắc, ngày lễ, loại vé đang áp dụng)
async function pricing() {
  await seedDemo();
  const rules = (await Store.find('price_rules', {}, { order: null, limit: 500 })).filter(r => r.active !== false);
  const holidays = await Store.find('holidays', {}, { order: null, limit: 1000 });
  const typeRows = (await Store.find('ticket_types', {}, { order: null, limit: 50 })).filter(t => t.active !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const types = typeRows.length
    ? Object.fromEntries(typeRows.map(t => [t.id, { label: t.label, off: Number(t.off) || 0, note: t.note || '' }]))
    : { ...Catalog.TICKET_TYPES };
  if (!types.ADULT) types.ADULT = Catalog.TICKET_TYPES.ADULT;
  return { rules, holidays: new Map(holidays.map(h => [h.id, h.name])), types };
}

// Quy tắc có khớp ngày (thứ / ngày lễ) và giờ bắt đầu của suất không
function ruleMatches(r, dow, holiday, time) {
  const dayOk = holiday ? (!!r.holiday || (r.days || []).includes(dow)) : (!r.holiday && (r.days || []).includes(dow));
  const end = !r.end_time || r.end_time === '00:00' ? '24:00' : r.end_time;
  return dayOk && time >= (r.start_time || '00:00') && time < end;
}

function priceOf(st, pr) {
  const p = vnParts(st.starts_at);
  const dow = new Date(new Date(st.starts_at).getTime() + VN).getUTCDay();
  const holiday = !!(pr && pr.holidays.has(p.date));
  const out = { ...Catalog.SEAT_PRICES };
  const applied = [];
  const rules = ((pr && pr.rules) || []).filter(r => ruleMatches(r, dow, holiday, p.time)).sort((a, b) => (a.priority || 0) - (b.priority || 0));
  for (const r of rules) {
    if (Number(r.price_standard)) out.standard = Number(r.price_standard);
    if (Number(r.price_vip)) out.vip = Number(r.price_vip);
    if (Number(r.price_sweetbox)) out.sweetbox = Number(r.price_sweetbox);
    applied.push(r.name);
  }
  const own = Number(st.price_standard) || Number(st.price_vip) || Number(st.price_sweetbox);
  if (Number(st.price_standard)) out.standard = Number(st.price_standard);
  if (Number(st.price_vip)) out.vip = Number(st.price_vip);
  if (Number(st.price_sweetbox)) out.sweetbox = Number(st.price_sweetbox);
  if (own) applied.push('Giá riêng của suất');
  return { ...out, rules: applied, holiday: holiday ? pr.holidays.get(p.date) : null };
}

// ---------------------------------------------------------------------------
// Dữ liệu khởi tạo (chạy thử bằng bộ nhớ trong) – trên Supabase dùng migration
// ---------------------------------------------------------------------------
function seedRows() {
  const movies = Object.entries(Catalog.MOVIES)
    .filter(([k]) => !Catalog.MOVIE_ALIASES[k])
    .map(([k, m]) => {
      const dur = /(\d+)\s*phút/.exec(m.meta || '');
      return { id: k, title: m.title, short_title: m.shortTitle, age: m.age, meta: m.meta, poster: m.poster, format: m.format, badge: m.badge, duration_min: dur ? +dur[1] : null, status: 'NOW' };
    });
  const cinemas = Catalog.CINEMAS.map(name => ({ id: slug(name), name, city: /Quang Trung|Ung Văn Khiêm|Trần Quang Khải/.test(name) ? 'TP.HCM' : /Thái Nguyên|Bắc Giang|Nha Trang/.test(name) ? name.replace('Beta ', '') : 'Hà Nội', address: '', active: true }));
  const ticketTypes = Object.entries(Catalog.TICKET_TYPES).map(([id, t], i) => ({ id, label: t.label, off: t.off, note: t.note, active: true, sort: i }));
  const priceRules = DEFAULT_RULES.map(r => ({ ...r, active: true }));
  const vouchers = Object.entries(Catalog.VOUCHERS).map(([code, v]) => ({ id: code, discount: v.discount, label: v.label, max_uses: null, per_customer: null, starts_at: null, ends_at: null, active: true }));
  return { movies, cinemas, vouchers, ticketTypes, priceRules };
}

let seeded = false;
async function seedDemo() {
  if (seeded || Store.isLive()) return;
  seeded = true;
  if ((await Store.find('movies', {}, { limit: 1, order: null })).length) return;
  const { movies, cinemas, vouchers, ticketTypes, priceRules } = seedRows();
  for (const t of ticketTypes) await Store.insert('ticket_types', t);
  for (const r of priceRules) await Store.insert('price_rules', r);
  for (const m of movies) await Store.insert('movies', m);
  for (const c of cinemas) await Store.insert('cinemas', c);
  for (const v of vouchers) await Store.insert('vouchers', v);
  // 7 ngày tới: mỗi rạp chiếu 6 phim, mỗi phim 3 suất (giờ lệch nhau theo phim)
  const SLOTS = ['09:30', '12:15', '14:45', '17:00', '19:30', '21:15', '22:45'];
  const today = vnToday();
  for (let d = 0; d < 7; d++) {
    const date = addDays(today, d);
    for (const [ci, c] of cinemas.entries()) {
      for (let k = 0; k < 6; k++) {
        const m = movies[(ci + k) % movies.length];
        for (let s = 0; s < 3; s++) {
          const time = SLOTS[(k + s * 2 + d) % SLOTS.length];
          await Store.insert('showtimes', { movie_id: m.id, cinema_id: c.id, starts_at: vnIso(date, time), format: m.badge || '2D', room: 'Phòng ' + pad(1 + (k % 4)), price_standard: null, price_vip: null, price_sweetbox: null, active: true });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Đọc danh mục
// ---------------------------------------------------------------------------
async function movies({ all = false } = {}) {
  await seedDemo();
  const rows = await Store.find('movies', {}, { order: 'created_at', asc: true, limit: 500 });
  return rows.filter(m => all || m.status !== 'HIDDEN').map(publicMovie);
}
async function cinemas({ all = false } = {}) {
  await seedDemo();
  const rows = await Store.find('cinemas', {}, { order: 'created_at', asc: true, limit: 200 });
  return rows.filter(c => all || c.active !== false).map(c => ({ id: c.id, name: c.name, city: c.city, address: c.address, active: c.active !== false }));
}

// Đếm ghế đã giữ/bán của nhiều suất trong một truy vấn
async function takenCounts(ids, now = new Date()) {
  if (!ids.length) return {};
  const holds = await Store.find('seat_holds', { showtime_key: { in: ids } }, { order: null, limit: 20000 });
  const out = {};
  for (const h of holds) {
    if (h.status === 'HELD' && h.expires_at && new Date(h.expires_at) <= now) continue;
    out[h.showtime_key] = (out[h.showtime_key] || 0) + 1;
  }
  return out;
}

function shape(st, movie, cinema, taken = 0, pr = null) {
  const p = vnParts(st.starts_at);
  return {
    id: st.id, movie_key: st.movie_id, cinema_id: st.cinema_id, cinema: cinema ? cinema.name : st.cinema_id,
    starts_at: st.starts_at, date: p.date, date_label: p.label, time: p.time, late: p.late,
    format: st.format || '2D', room: st.room || 'Phòng 01', active: st.active !== false,
    prices: priceOf(st, pr), seats_total: Catalog.SEAT_IDS.length, seats_free: Math.max(0, Catalog.SEAT_IDS.length - taken),
    movie: movie ? publicMovie(movie) : null
  };
}

// Suất chiếu theo rạp / ngày / phim (ngày theo giờ VN). Mặc định ẩn suất đã qua giờ chiếu.
async function showtimes({ cinema, date, movie, from, days = 1, includePast = false, includeInactive = false } = {}) {
  await seedDemo();
  const start = date || from || vnToday();
  const filter = { starts_at: { gte: vnIso(start, '00:00'), lt: vnIso(addDays(start, days), '00:00') } };
  if (cinema) filter.cinema_id = cinema;
  if (movie) filter.movie_id = movie;
  let rows = await Store.find('showtimes', filter, { order: 'starts_at', asc: true, limit: 3000 });
  const now = new Date();
  rows = rows.filter(r => (includeInactive || r.active !== false) && (includePast || new Date(r.starts_at) > now));
  const mv = Object.fromEntries((await Store.find('movies', {}, { order: null, limit: 500 })).map(m => [m.id, m]));
  const cn = Object.fromEntries((await Store.find('cinemas', {}, { order: null, limit: 200 })).map(c => [c.id, c]));
  const taken = await takenCounts(rows.map(r => r.id), now);
  const pr = await pricing();
  return rows.filter(r => mv[r.movie_id]).map(r => shape(r, mv[r.movie_id], cn[r.cinema_id], taken[r.id] || 0, pr));
}

async function getShowtime(id) {
  await seedDemo();
  const st = id ? await Store.one('showtimes', { id: String(id) }) : null;
  if (!st) return null;
  const [movie, cinema] = await Promise.all([Store.one('movies', { id: st.movie_id }), Store.one('cinemas', { id: st.cinema_id })]);
  const taken = await takenCounts([st.id]);
  return shape(st, movie, cinema, taken[st.id] || 0, await pricing());
}

// ---------------------------------------------------------------------------
// Voucher: kiểm tra hạn dùng, số lượt toàn hệ thống và số lượt mỗi khách
// ---------------------------------------------------------------------------
const USED_STATUSES = ['PENDING', 'CONFIRMED', 'CONFIRMED_LATE'];
async function voucherUsage(code, userId) {
  const rows = await Store.find('orders', { voucher: code, status: { in: USED_STATUSES } }, { order: null, limit: 100000 });
  return { total: rows.length, mine: userId ? rows.filter(o => o.user_id === userId).length : 0 };
}
async function checkVoucher(code, userId, now = new Date()) {
  await seedDemo();
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const v = await Store.one('vouchers', { id: c });
  const bad = () => httpError('Mã giảm giá không hợp lệ hoặc đã hết lượt dùng', 400);
  if (!v || v.active === false) throw bad();
  if (v.starts_at && new Date(v.starts_at) > now) throw httpError('Mã giảm giá chưa đến thời gian áp dụng', 400);
  if (v.ends_at && new Date(v.ends_at) < now) throw httpError('Mã giảm giá đã hết hạn', 400);
  const used = await voucherUsage(c, userId);
  if (v.max_uses && used.total >= v.max_uses) throw httpError('Mã giảm giá đã hết lượt dùng', 400);
  if (v.per_customer && userId && used.mine >= v.per_customer) throw httpError(`Bạn đã dùng mã này ${used.mine} lần (tối đa ${v.per_customer})`, 400);
  return { code: c, discount: Number(v.discount) || 0, label: v.label || '' };
}

module.exports = {
  slug, vnIso, vnParts, vnToday, addDays, MOVIE_STATUS, publicMovie, priceOf, pricing, ruleMatches, DEFAULT_RULES, DOW_LABEL, seedRows, seedDemo,
  movies, cinemas, showtimes, getShowtime, checkVoucher, voucherUsage, takenCounts
};
