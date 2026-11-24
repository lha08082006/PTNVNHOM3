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

// Giải thích phân loại phim theo độ tuổi (Luật Điện ảnh 2022)
const AGE_NOTE = {
  P: 'Phim được phép phổ biến đến người xem ở mọi độ tuổi.',
  K: 'Phim dành cho khán giả dưới 13 tuổi, cần xem cùng cha mẹ hoặc người giám hộ.',
  T13: 'Phim dành cho khán giả từ đủ 13 tuổi trở lên.',
  T16: 'Phim dành cho khán giả từ đủ 16 tuổi trở lên.',
  T18: 'Phim dành cho khán giả từ đủ 18 tuổi trở lên.'
};
const metaPart = (m, i) => String(m.meta || '').split('·').map(x => x.trim())[i] || '';

// Database cũ lưu poster .jpg; web có sẵn bản .webp cùng tên (nhẹ hơn nhiều) -> trả .webp khi biết chắc file tồn tại
const WEBP_POSTERS = new Set(Object.values(Catalog.MOVIES || {}).map(x => x && x.poster).filter(p => /\.webp$/i.test(p || '')));
const posterOf = (p) => { if (!p) return p; const w = String(p).replace(/\.(jpe?g|png)$/i, '.webp'); return w !== p && WEBP_POSTERS.has(w) ? w : p; };
const publicMovie = (m) => m && ({
  key: m.id, title: m.title, shortTitle: m.short_title || m.title, age: m.age || '', meta: m.meta || '',
  poster: posterOf(m.poster) || 'images/400x633-145627-230926-40.jpg', format: m.format || '2D', badge: m.badge || '2D',
  duration_min: m.duration_min || null, status: m.status || 'NOW', trailer: m.trailer || null,
  // Thông tin chi tiết (Quản lý nhập ở admin > Danh mục > Phim); thể loại / ngôn ngữ lấy từ meta nếu chưa nhập
  genre: m.genre || metaPart(m, 0), language: m.language || metaPart(m, 2), director: m.director || '', cast: m.cast_list || '',
  release_date: m.release_date || null, synopsis: m.synopsis || '', age_note: AGE_NOTE[String(m.age || '').toUpperCase()] || ''
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
  const [ruleRows, holidays, typeAll] = await Promise.all([
    Store.find('price_rules', {}, { order: null, limit: 500 }), Store.find('holidays', {}, { order: null, limit: 1000 }),
    Store.find('ticket_types', {}, { order: null, limit: 50 })]);
  const rules = ruleRows.filter(r => r.active !== false);
  const typeRows = typeAll.filter(t => t.active !== false)
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
// Voucher mẫu cho bản chạy thử (bộ nhớ trong). Web thật đọc bảng vouchers trong database.
const SEED_VOUCHERS = {
    BETAVIP:   { discount: 20000, label: 'Giảm 20.000 đ cho thành viên' },
    ALPHA:     { discount: 20000, label: 'Giảm 20.000 đ' },
    CINEMA:    { discount: 20000, label: 'Giảm 20.000 đ' },
    COMBO30:   { discount: 30000, label: 'Giảm 30.000 đ khi mua kèm bắp nước', need_combo: true },
    T3VUIVE:   { kind: 'PERCENT', percent: 15, max_discount: 40000, weekdays: [2], label: 'Suất chiếu thứ Ba giảm 15% (tối đa 40.000 đ)' },
    NEWMEMBER: { discount: 50000, min_total: 150000, per_customer: 1, label: 'Thành viên mới giảm 50.000 đ cho đơn từ 150.000 đ' }
};

function seedRows() {
  const movies = Object.entries(Catalog.MOVIES)
    .filter(([k]) => !Catalog.MOVIE_ALIASES[k])
    .map(([k, m]) => {
      const dur = /(\d+)\s*phút/.exec(m.meta || '');
      return { id: k, title: m.title, short_title: m.shortTitle, age: m.age, meta: m.meta, poster: m.poster, format: m.format, badge: m.badge, duration_min: dur ? +dur[1] : null, status: 'NOW' };
    });
  // Tọa độ gần đúng (trung tâm quận / thành phố) để gợi ý "rạp gần tôi"; Quản lý chỉnh lại trong admin
  const COORDS = {
    'beta-thanh-xuan': [21.0005, 105.8148], 'beta-tran-quang-khai': [10.7920, 106.6890], 'beta-giai-phong': [20.9850, 105.8410],
    'beta-my-dinh': [21.0280, 105.7720], 'beta-quang-trung': [10.8350, 106.6650], 'beta-ung-van-khiem': [10.8060, 106.7160],
    'beta-thai-nguyen': [21.5940, 105.8480], 'beta-bac-giang': [21.2730, 106.1940], 'beta-nha-trang': [12.2380, 109.1960]
  };
  const cinemas = Catalog.CINEMAS.map(name => ({ id: slug(name), name, lat: (COORDS[slug(name)] || [])[0] || null, lng: (COORDS[slug(name)] || [])[1] || null, city: /Quang Trung|Ung Văn Khiêm|Trần Quang Khải/.test(name) ? 'TP.HCM' : /Thái Nguyên|Bắc Giang|Nha Trang/.test(name) ? name.replace('Beta ', '') : 'Hà Nội', address: '', active: true }));
  const ticketTypes = Object.entries(Catalog.TICKET_TYPES).map(([id, t], i) => ({ id, label: t.label, off: t.off, note: t.note, active: true, sort: i }));
  const priceRules = DEFAULT_RULES.map(r => ({ ...r, active: true }));
  const vouchers = Object.entries(SEED_VOUCHERS).map(([code, v]) => ({
    id: code, kind: v.kind || 'AMOUNT', discount: v.discount || 0, percent: v.percent || null, max_discount: v.max_discount || null,
    min_total: v.min_total || null, need_combo: !!v.need_combo, weekdays: v.weekdays || [], label: v.label,
    max_uses: null, per_customer: v.per_customer || null, starts_at: null, ends_at: null, active: true
  }));
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
  // 14 ngày tới: mỗi rạp chiếu 6 phim, mỗi phim 3 suất (giờ lệch nhau theo phim)
  const SLOTS = ['09:30', '12:15', '14:45', '17:00', '19:30', '21:15', '22:45'];
  const today = vnToday();
  for (let d = 0; d < 14; d++) {
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
  return rows.filter(c => all || c.active !== false).map(publicCinema);
}
// Đợt 9: thêm hotline, ảnh, giới thiệu, tiện ích (danh sách cách nhau dấu phẩy / xuống dòng) cho trang Rạp
const publicCinema = (c) => ({
  id: c.id, name: c.name, city: c.city, address: c.address, active: c.active !== false,
  lat: c.lat != null ? Number(c.lat) : null, lng: c.lng != null ? Number(c.lng) : null,
  phone: c.phone || '', image: c.image || '', intro: c.intro || '',
  amenities: String(c.amenities || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)
});
// Phòng chiếu đang hoạt động của một rạp: tên, loại, số ghế (không trả sơ đồ chi tiết)
async function roomsOf(cinemaId) {
  const rows = await Store.find('rooms', { cinema_id: cinemaId }, { order: 'name', asc: true, limit: 100 });
  return rows.filter(r => r.active !== false).map(r => ({ name: r.name, kind: r.kind || '2D', seats: Catalog.seatsOf(layoutOf(r)).length }));
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

// Sơ đồ ghế của suất: theo phòng (rooms.layout) hoặc sơ đồ mặc định
function layoutOf(room) {
  if (room && room.layout) { try { return Catalog.normLayout(room.layout); } catch (e) { /* sơ đồ hỏng: dùng mặc định */ } }
  return Catalog.DEFAULT_LAYOUT;
}
async function roomsById() {
  return Object.fromEntries((await Store.find('rooms', {}, { order: null, limit: 1000 })).map(r => [r.id, r]));
}

function shape(st, movie, cinema, taken = 0, pr = null, room = null, withLayout = false) {
  const layout = layoutOf(room);
  const total = Catalog.seatsOf(layout).length;
  const p = vnParts(st.starts_at);
  const dur = movie && Number(movie.duration_min);
  const end = dur ? vnParts(new Date(new Date(st.starts_at).getTime() + dur * MIN).toISOString()).time : null;
  return {
    id: st.id, movie_key: st.movie_id, cinema_id: st.cinema_id, cinema: cinema ? cinema.name : st.cinema_id,
    starts_at: st.starts_at, date: p.date, date_label: p.label, time: p.time, late: p.late, end_time: end,
    format: st.format || '2D', room: (room && room.name) || st.room || 'Phòng 01', room_id: st.room_id || null, active: st.active !== false,
    prices: priceOf(st, pr), seats_total: total, seats_free: Math.max(0, total - taken),
    ...(withLayout ? { layout } : {}),
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
  // Các truy vấn phụ chạy song song (mỗi lượt hỏi database là một vòng mạng)
  const [mvRows, cnRows, taken, pr, rooms] = await Promise.all([
    Store.find('movies', {}, { order: null, limit: 500 }), Store.find('cinemas', {}, { order: null, limit: 200 }),
    takenCounts(rows.map(r => r.id), now), pricing(), roomsById()]);
  const mv = Object.fromEntries(mvRows.map(m => [m.id, m]));
  const cn = Object.fromEntries(cnRows.map(c => [c.id, c]));
  return rows.filter(r => mv[r.movie_id]).map(r => shape(r, mv[r.movie_id], cn[r.cinema_id], taken[r.id] || 0, pr, rooms[r.room_id]));
}

async function getShowtime(id) {
  await seedDemo();
  const st = id ? await Store.one('showtimes', { id: String(id) }) : null;
  if (!st) return null;
  const [movie, cinema, room] = await Promise.all([Store.one('movies', { id: st.movie_id }), Store.one('cinemas', { id: st.cinema_id }), st.room_id ? Store.one('rooms', { id: st.room_id }) : null]);
  const taken = await takenCounts([st.id]);
  return shape(st, movie, cinema, taken[st.id] || 0, await pricing(), room, true);
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
  const bad = () => httpError('Mã giảm giá không hợp lệ hoặc đã hết lượt dùng', 400);
  // Mã voucher chỉ gồm chữ in hoa, số, - _ (như lúc Quản lý tạo mã): chuỗi lạ trả 400 ngay, không hỏi database
  if (!/^[A-Z0-9_-]{3,30}$/.test(c)) throw bad();
  const v = await Store.one('vouchers', { id: c });
  if (!v || v.active === false) throw bad();
  if (v.starts_at && new Date(v.starts_at) > now) throw httpError('Mã giảm giá chưa đến thời gian áp dụng', 400);
  if (v.ends_at && new Date(v.ends_at) < now) throw httpError('Mã giảm giá đã hết hạn', 400);
  const used = await voucherUsage(c, userId);
  if (v.max_uses && used.total >= v.max_uses) throw httpError('Mã giảm giá đã hết lượt dùng', 400);
  if (v.per_customer && userId && used.mine >= v.per_customer) throw httpError(`Bạn đã dùng mã này ${used.mine} lần (tối đa ${v.per_customer})`, 400);
  return {
    code: c, label: v.label || '', kind: v.kind || 'AMOUNT', discount: Number(v.discount) || 0, percent: Number(v.percent) || 0,
    max_discount: Number(v.max_discount) || 0, min_total: Number(v.min_total) || 0, need_combo: !!v.need_combo,
    weekdays: Array.isArray(v.weekdays) ? v.weekdays : []
  };
}

module.exports = { SEED_VOUCHERS,
  AGE_NOTE, slug, vnIso, vnParts, vnToday, addDays, MOVIE_STATUS, publicMovie, priceOf, pricing, ruleMatches, DEFAULT_RULES, DOW_LABEL, seedRows, seedDemo,
  movies, cinemas, showtimes, getShowtime, checkVoucher, voucherUsage, takenCounts, roomsOf, publicCinema
};
