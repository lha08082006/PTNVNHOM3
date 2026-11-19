// lib/catalog-admin.js - Quản lý danh mục (chỉ Quản lý): phim, rạp, suất chiếu, voucher
const Store = require('./store');
const CatalogDB = require('./catalog-db');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const money = (v) => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); if (!(n >= 0)) throw httpError('Giá tiền không hợp lệ', 400); return n; };
const intOrNull = (v) => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); if (!(n > 0)) throw httpError('Số lượt phải là số dương', 400); return n; };

async function overview() {
  await CatalogDB.seedDemo();
  const vouchers = await Store.find('vouchers', {}, { order: 'created_at', asc: true, limit: 500 });
  for (const v of vouchers) v.used = (await CatalogDB.voucherUsage(v.id)).total;
  return {
    movies: await Store.find('movies', {}, { order: 'created_at', asc: true, limit: 500 }),
    cinemas: await CatalogDB.cinemas({ all: true }),
    vouchers,
    statuses: CatalogDB.MOVIE_STATUS,
    today: CatalogDB.vnToday()
  };
}

async function saveMovie(b) {
  const title = str(b.title, 160);
  if (title.length < 2) throw httpError('Nhập tên phim', 400);
  const id = str(b.id, 80) || CatalogDB.slug(title);
  if (!/^[a-z0-9-]{2,80}$/.test(id)) throw httpError('Mã phim chỉ gồm chữ thường, số và dấu gạch ngang', 400);
  const status = CatalogDB.MOVIE_STATUS[b.status] ? b.status : 'NOW';
  const row = {
    title, short_title: str(b.short_title, 120) || title, age: str(b.age, 8), meta: str(b.meta, 300),
    poster: str(b.poster, 500) || 'images/400x633-145627-230926-40.jpg', format: str(b.format, 60) || '2D', badge: str(b.badge, 40) || '2D',
    duration_min: b.duration_min ? Math.round(Number(b.duration_min)) || null : null, trailer: str(b.trailer, 300) || null, status,
    genre: str(b.genre, 120) || null, language: str(b.language, 120) || null, director: str(b.director, 200) || null,
    cast_list: str(b.cast, 500) || null, synopsis: str(b.synopsis, 3000) || null,
    release_date: /^\d{4}-\d{2}-\d{2}$/.test(str(b.release_date, 10)) ? str(b.release_date, 10) : null
  };
  const exists = await Store.one('movies', { id });
  if (exists) { const [u] = await Store.update('movies', { id }, row); return u; }
  return Store.insert('movies', { id, ...row });
}

async function saveCinema(b) {
  const name = str(b.name, 120);
  if (name.length < 2) throw httpError('Nhập tên rạp', 400);
  const id = str(b.id, 80) || CatalogDB.slug(name);
  const coord = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); if (!(n >= lo && n <= hi)) throw httpError('Tọa độ không hợp lệ', 400); return n; };
  const row = { name, city: str(b.city, 80), address: str(b.address, 300), active: b.active !== false && b.active !== 'false',
    lat: coord(b.lat, -90, 90), lng: coord(b.lng, -180, 180) };
  const exists = await Store.one('cinemas', { id });
  if (exists) { const [u] = await Store.update('cinemas', { id }, row); return u; }
  return Store.insert('cinemas', { id, ...row });
}

// Tạo hàng loạt: nhiều giờ chiếu x nhiều ngày liên tiếp. Bỏ qua suất trùng (cùng phim, rạp, giờ).
async function createShowtimes(b) {
  const movie = await Store.one('movies', { id: str(b.movie_id) });
  const cinema = await Store.one('cinemas', { id: str(b.cinema_id) });
  if (!movie) throw httpError('Chọn phim', 400);
  if (!cinema) throw httpError('Chọn rạp', 400);
  const times = String(b.times || '').split(/[\s,;]+/).filter(Boolean);
  if (!times.length || times.some(t => !/^\d{1,2}:\d{2}$/.test(t))) throw httpError('Nhập giờ chiếu dạng HH:MM, cách nhau bởi dấu phẩy', 400);
  const days = Math.min(31, Math.max(1, Math.round(Number(b.days) || 1)));
  const prices = { price_standard: money(b.price_standard), price_vip: money(b.price_vip), price_sweetbox: money(b.price_sweetbox) };
  const created = [], skipped = [];
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    const date = CatalogDB.addDays(str(b.date) || CatalogDB.vnToday(), d);
    for (const t of times) {
      const starts_at = CatalogDB.vnIso(date, t.padStart(5, '0'));
      if (new Date(starts_at).getTime() <= now) { skipped.push(`${date} ${t} (đã qua)`); continue; }
      const dup = await Store.one('showtimes', { movie_id: movie.id, cinema_id: cinema.id, starts_at });
      if (dup) { skipped.push(`${date} ${t} (đã có)`); continue; }
      created.push(await Store.insert('showtimes', {
        movie_id: movie.id, cinema_id: cinema.id, starts_at, format: str(b.format, 60) || movie.badge || '2D',
        room: str(b.room, 40) || 'Phòng 01', ...prices, active: true
      }));
    }
  }
  return { created: created.length, skipped };
}

async function updateShowtime(b) {
  const st = await Store.one('showtimes', { id: str(b.id) });
  if (!st) throw httpError('Không tìm thấy suất chiếu', 404);
  const patch = {};
  if (b.active !== undefined) {
    patch.active = !!b.active;
    if (!patch.active) {
      const holds = await Store.find('seat_holds', { showtime_key: st.id }, { order: null, limit: 1 });
      if (holds.length) throw httpError('Suất đã có khách giữ/mua ghế – không thể ngừng bán. Liên hệ CSKH để xử lý hoàn tiền trước.', 409);
    }
  }
  for (const k of ['price_standard', 'price_vip', 'price_sweetbox']) if (b[k] !== undefined) patch[k] = money(b[k]);
  if (b.room !== undefined) patch.room = str(b.room, 40);
  const [u] = await Store.update('showtimes', { id: st.id }, patch);
  return u;
}

async function saveVoucher(b) {
  const id = str(b.code || b.id, 30).toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(id)) throw httpError('Mã voucher 3–30 ký tự (chữ in hoa, số, - _)', 400);
  const discount = money(b.discount);
  if (!(discount > 0)) throw httpError('Nhập số tiền giảm', 400);
  const date = (v) => v ? new Date(v).toISOString() : null;
  const row = {
    discount, label: str(b.label, 120) || `Giảm ${discount.toLocaleString('vi-VN')} đ`,
    max_uses: intOrNull(b.max_uses), per_customer: intOrNull(b.per_customer),
    starts_at: date(b.starts_at), ends_at: date(b.ends_at), active: b.active !== false && b.active !== 'false'
  };
  const exists = await Store.one('vouchers', { id });
  if (exists) { const [u] = await Store.update('vouchers', { id }, row); return u; }
  return Store.insert('vouchers', { id, ...row });
}

// ---------------------------------------------------------------------------
// Bảng giá (Quản lý): loại vé, quy tắc giá theo ngày / khung giờ, ngày lễ
// ---------------------------------------------------------------------------
const hhmm = (v, def) => {
  const s = str(v, 5) || def;
  if (!/^([01]\d|2[0-4]):[0-5]\d$/.test(s) || (s.startsWith('24') && s !== '24:00')) throw httpError('Giờ phải dạng HH:MM (00:00–24:00)', 400);
  return s;
};

async function pricingOverview() {
  await CatalogDB.seedDemo();
  return {
    ticket_types: (await Store.find('ticket_types', {}, { order: null, limit: 50 })).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
    rules: (await Store.find('price_rules', {}, { order: null, limit: 500 })).sort((a, b) => (a.priority || 0) - (b.priority || 0)),
    holidays: (await Store.find('holidays', {}, { order: null, limit: 1000 })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    default_prices: require('../catalog').SEAT_PRICES
  };
}

async function saveTicketType(b) {
  const id = str(b.id, 20).toUpperCase();
  if (!/^[A-Z_]{3,20}$/.test(id)) throw httpError('Mã loại vé 3–20 chữ in hoa (vd STUDENT)', 400);
  const label = str(b.label, 60);
  if (label.length < 2) throw httpError('Nhập tên loại vé', 400);
  const off = id === 'ADULT' ? 0 : money(b.off) || 0;
  const row = { label, off, note: str(b.note, 200), active: id === 'ADULT' ? true : b.active !== false && b.active !== 'false', sort: Math.round(Number(b.sort) || 0) };
  const exists = await Store.one('ticket_types', { id });
  if (exists) { const [u] = await Store.update('ticket_types', { id }, row); return u; }
  return Store.insert('ticket_types', { id, ...row });
}

async function savePriceRule(b) {
  const name = str(b.name, 80);
  if (name.length < 2) throw httpError('Nhập tên quy tắc giá', 400);
  const days = (Array.isArray(b.days) ? b.days : String(b.days || '').split(',')).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  const holiday = b.holiday === true || b.holiday === 'true';
  if (!days.length && !holiday) throw httpError('Chọn ít nhất một thứ trong tuần hoặc áp dụng cho ngày lễ', 400);
  const start_time = hhmm(b.start_time, '00:00');
  const end_time = hhmm(b.end_time, '24:00');
  if (start_time >= end_time) throw httpError('Giờ bắt đầu phải trước giờ kết thúc', 400);
  const row = {
    name, days: [...new Set(days)].sort(), holiday, start_time, end_time,
    price_standard: money(b.price_standard), price_vip: money(b.price_vip), price_sweetbox: money(b.price_sweetbox),
    priority: Math.round(Number(b.priority) || 0), active: b.active !== false && b.active !== 'false'
  };
  if (!row.price_standard && !row.price_vip && !row.price_sweetbox) throw httpError('Nhập ít nhất một mức giá', 400);
  if (b.id) {
    const [u] = await Store.update('price_rules', { id: str(b.id) }, row);
    if (!u) throw httpError('Không tìm thấy quy tắc giá', 404);
    return u;
  }
  return Store.insert('price_rules', row);
}

async function deletePriceRule(id) {
  await Store.remove('price_rules', { id: str(id) });
  return { ok: true };
}

async function saveHoliday(b) {
  const id = str(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) throw httpError('Ngày lễ dạng YYYY-MM-DD', 400);
  const name = str(b.name, 80) || 'Ngày lễ';
  const exists = await Store.one('holidays', { id });
  if (exists) { const [u] = await Store.update('holidays', { id }, { name }); return u; }
  return Store.insert('holidays', { id, name });
}

async function deleteHoliday(date) {
  await Store.remove('holidays', { id: str(date, 10) });
  return { ok: true };
}

module.exports = { pricingOverview, saveTicketType, savePriceRule, deletePriceRule, saveHoliday, deleteHoliday, overview, saveMovie, saveCinema, createShowtimes, updateShowtime, saveVoucher };
