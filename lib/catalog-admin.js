// lib/catalog-admin.js - Quản lý danh mục (chỉ Quản lý): phim, rạp, suất chiếu, voucher
const Store = require('./store');
const CatalogDB = require('./catalog-db');
const Catalog = require('../catalog');

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
    rooms: (await Store.find('rooms', {}, { order: 'created_at', asc: true, limit: 1000 })).map(r => ({ ...r, seats: Catalog.seatsOf(Catalog.normLayout(r.layout)).length, layout_text: Catalog.layoutToText(Catalog.normLayout(r.layout)) })),
    default_layout_text: Catalog.layoutToText(Catalog.DEFAULT_LAYOUT),
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
  const row = { name, city: str(b.city, 80), address: str(b.address, 300), active: b.active !== false && b.active !== 'false' };
  // Đợt 9: thông tin cho trang Rạp – chỉ cập nhật trường có gửi lên
  if (b.phone !== undefined) {
    const phone = str(b.phone, 40);
    if (phone && !/^[0-9 +().-]{6,40}$/.test(phone)) throw httpError('Số điện thoại rạp không hợp lệ', 400);
    row.phone = phone;
  }
  if (b.image !== undefined) {
    const img = str(b.image, 500);
    if (img && !/^(https:\/\/|images\/|\/images\/)/.test(img)) throw httpError('Ảnh rạp phải là link https:// hoặc đường dẫn images/…', 400);
    row.image = img;
  }
  if (b.intro !== undefined) row.intro = str(b.intro, 2000);
  if (b.amenities !== undefined) row.amenities = str(b.amenities, 500);
  // Chỉ đổi tọa độ khi có gửi lên (gửi chuỗi rỗng = xóa); không gửi thì giữ nguyên
  if (b.lat !== undefined) row.lat = coord(b.lat, -90, 90);
  if (b.lng !== undefined) row.lng = coord(b.lng, -180, 180);
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
  // Phòng chiếu có sơ đồ ghế riêng (Đợt 3): phải thuộc rạp đã chọn; chặn hai suất chồng giờ trong cùng phòng
  const room = str(b.room_id) ? await Store.one('rooms', { id: str(b.room_id) }) : null;
  if (str(b.room_id) && (!room || room.cinema_id !== cinema.id || room.active === false)) throw httpError('Phòng chiếu không thuộc rạp đã chọn hoặc đã ngừng dùng', 400);
  const busyMs = ((Number(movie.duration_min) || 120) + CLEAN_MIN) * 60000;
  const skipped = [];
  const now = Date.now();
  // Đợt 10g: gom mọi suất định tạo, rồi đọc suất đang có của rạp trong khoảng đó bằng MỘT truy vấn (trước đây mỗi suất
  // 2–3 lượt hỏi database lần lượt – 7 ngày × 5 giờ chiếu mất gần 10 giây, dễ bị Vercel cắt giữa chừng)
  const slots = [];
  for (let d = 0; d < days; d++) {
    const date = CatalogDB.addDays(str(b.date) || CatalogDB.vnToday(), d);
    for (const t of times) {
      const starts_at = CatalogDB.vnIso(date, t.padStart(5, '0'));
      if (new Date(starts_at).getTime() <= now) { skipped.push(`${date} ${t} (đã qua)`); continue; }
      slots.push({ date, t, starts_at, ms: new Date(starts_at).getTime() });
    }
  }
  const rows = [];
  if (slots.length) {
    const lo = Math.min(...slots.map(s => s.ms)), hi = Math.max(...slots.map(s => s.ms));
    const existing = (await Store.find('showtimes', { cinema_id: cinema.id, starts_at: { gte: new Date(lo - 6 * 3600e3).toISOString(), lte: new Date(hi + busyMs).toISOString() } }, { order: null, limit: 5000 }));
    const taken = new Set(existing.filter(s => s.movie_id === movie.id).map(s => new Date(s.starts_at).getTime()));
    // Khung bận của phòng: suất đang có (theo thời lượng phim của từng suất) + suất vừa xếp trong lượt này
    const busy = [];
    if (room) {
      const inRoom = existing.filter(s => s.room_id === room.id && s.active !== false);
      const ids = [...new Set(inRoom.map(s => s.movie_id))];
      const mvs = ids.length ? Object.fromEntries((await Store.find('movies', { id: { in: ids } }, { order: null, limit: 500 })).map(m => [m.id, m])) : {};
      for (const s of inRoom) { const st = new Date(s.starts_at).getTime(); busy.push({ st, end: st + ((Number((mvs[s.movie_id] || {}).duration_min) || 120) + CLEAN_MIN) * 60000, at: s.starts_at }); }
    }
    for (const s of slots.sort((a, b) => a.ms - b.ms)) {
      if (taken.has(s.ms)) { skipped.push(`${s.date} ${s.t} (đã có)`); continue; }
      if (room) {
        const clash = busy.find(x => x.st < s.ms + busyMs && x.end > s.ms);
        if (clash) { skipped.push(`${s.date} ${s.t} (${room.name} đang có suất ${CatalogDB.vnParts(clash.at).time})`); continue; }
        busy.push({ st: s.ms, end: s.ms + busyMs, at: s.starts_at });
      }
      taken.add(s.ms);
      rows.push({
        movie_id: movie.id, cinema_id: cinema.id, starts_at: s.starts_at, format: str(b.format, 60) || movie.badge || '2D',
        room: room ? room.name : (str(b.room, 40) || 'Phòng 01'), room_id: room ? room.id : null, ...prices, active: true
      });
    }
  }
  let created = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const res = await Promise.allSettled(rows.slice(i, i + 10).map(r => Store.insert('showtimes', r)));
    res.forEach((x, k) => {
      if (x.status === 'fulfilled') created++;
      else { const r = rows[i + k]; const p = CatalogDB.vnParts(r.starts_at); skipped.push(`${p.date} ${p.time} (lỗi lưu: ${String(x.reason && x.reason.message || x.reason).slice(0, 80)})`); }
    });
  }
  return { created, skipped };
}

// Suất đang có trong phòng mà thời gian chiếu + dọn phòng chồng lên khung [starts_at, starts_at + busyMs)
async function roomClash(roomId, starts_at, busyMs) {
  const t0 = new Date(starts_at).getTime();
  const near = await Store.find('showtimes', { room_id: roomId, starts_at: { gte: new Date(t0 - 6 * 3600e3).toISOString(), lt: new Date(t0 + busyMs).toISOString() } }, { order: null, limit: 50 });
  const mvs = {};
  for (const s of near) {
    if (s.active === false) continue;
    mvs[s.movie_id] = mvs[s.movie_id] || await Store.one('movies', { id: s.movie_id });
    const end = new Date(s.starts_at).getTime() + ((Number((mvs[s.movie_id] || {}).duration_min) || 120) + CLEAN_MIN) * 60000;
    if (end > t0) return s;
  }
  return null;
}

// Sao chép lịch (Đợt 6): mọi suất đang bán của rạp trong [from, from + days) -> cùng giờ, cùng phòng, cùng phim, cùng giá riêng
// sang [to, to + days). Bỏ qua suất đã qua giờ, đã có, phòng bận, phim đã ẩn.
async function copyShowtimes(b) {
  const cinema = await Store.one('cinemas', { id: str(b.cinema_id) });
  if (!cinema) throw httpError('Chọn rạp', 400);
  const from = str(b.from, 10), to = str(b.to, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw httpError('Chọn ngày nguồn và ngày đích', 400);
  if (from === to) throw httpError('Ngày đích phải khác ngày nguồn', 400);
  const days = Math.min(14, Math.max(1, Math.round(Number(b.days) || 7)));
  const src = await Store.find('showtimes', { cinema_id: cinema.id, starts_at: { gte: CatalogDB.vnIso(from, '00:00'), lt: CatalogDB.vnIso(CatalogDB.addDays(from, days), '00:00') } }, { order: 'starts_at', asc: true, limit: 3000 });
  const shift = new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z');
  const created = [], skipped = [];
  const mvs = {};
  for (const s of src) {
    if (s.active === false) continue;
    const movie = mvs[s.movie_id] = mvs[s.movie_id] || await Store.one('movies', { id: s.movie_id });
    const starts_at = new Date(new Date(s.starts_at).getTime() + shift).toISOString();
    const label = CatalogDB.vnParts(starts_at).date + ' ' + CatalogDB.vnParts(starts_at).time + ' ' + (movie ? movie.short_title || movie.title : s.movie_id);
    if (!movie || movie.status === 'HIDDEN') { skipped.push(label + ' (phim đã ẩn)'); continue; }
    if (new Date(starts_at).getTime() <= Date.now()) { skipped.push(label + ' (đã qua)'); continue; }
    if (await Store.one('showtimes', { movie_id: s.movie_id, cinema_id: cinema.id, starts_at })) { skipped.push(label + ' (đã có)'); continue; }
    if (s.room_id) {
      const clash = await roomClash(s.room_id, starts_at, ((Number(movie.duration_min) || 120) + CLEAN_MIN) * 60000);
      if (clash) { skipped.push(label + ' (' + (s.room || 'phòng') + ' bận)'); continue; }
    }
    created.push(await Store.insert('showtimes', {
      movie_id: s.movie_id, cinema_id: cinema.id, starts_at, format: s.format, room: s.room, room_id: s.room_id || null,
      price_standard: s.price_standard == null ? null : s.price_standard, price_vip: s.price_vip == null ? null : s.price_vip, price_sweetbox: s.price_sweetbox == null ? null : s.price_sweetbox,
      active: true
    }));
  }
  return { created: created.length, skipped, source: src.length };
}

// Gợi ý điều chỉnh suất (Đợt 6): lấp đầy 14 ngày qua theo phim tại rạp + số suất 7 ngày tới
async function scheduleInsights(cinemaId) {
  const today = CatalogDB.vnToday();
  const past = (await CatalogDB.showtimes({ cinema: cinemaId, from: CatalogDB.addDays(today, -14), days: 15, includePast: true })).filter(s => new Date(s.starts_at) < new Date());
  const next = await CatalogDB.showtimes({ cinema: cinemaId, from: today, days: 7 });
  const movies = await CatalogDB.movies();
  const by = {};
  for (const s of past) { const k = s.movie_key; by[k] = by[k] || { key: k, title: s.movie ? s.movie.title : k, shows: 0, sold: 0, total: 0 }; by[k].shows++; by[k].sold += s.seats_total - s.seats_free; by[k].total += s.seats_total; }
  const upcoming = {};
  for (const s of next) upcoming[s.movie_key] = (upcoming[s.movie_key] || 0) + 1;
  const rows = movies.filter(m => m.status !== 'HIDDEN').map(m => {
    const p = by[m.key] || { shows: 0, sold: 0, total: 0 };
    const rate = p.total ? Math.round(p.sold / p.total * 100) : null;
    let advice = '';
    if (m.status === 'NOW' && !upcoming[m.key]) advice = 'Chưa có suất 7 ngày tới';
    else if (rate != null && rate >= 70) advice = 'Bán chạy – nên tăng suất / phòng lớn hơn';
    else if (rate != null && rate < 20 && p.shows >= 3) advice = 'Ít khách – cân nhắc giảm suất';
    return { key: m.key, title: m.title, status: m.status, past_shows: p.shows, sold: p.sold, total: p.total, rate, next_7d: upcoming[m.key] || 0, advice };
  });
  return rows.sort((a, b) => (b.advice ? 1 : 0) - (a.advice ? 1 : 0) || (b.rate || 0) - (a.rate || 0));
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
  const kind = ['AMOUNT', 'PERCENT', 'PER_SEAT'].includes(String(b.kind || 'AMOUNT').toUpperCase()) ? String(b.kind || 'AMOUNT').toUpperCase() : 'AMOUNT';
  const discount = money(b.discount) || 0;
  const percent = kind === 'PERCENT' ? Math.round(Number(b.percent) || 0) : null;
  if (kind === 'PERCENT' ? !(percent >= 1 && percent <= 100) : !(discount > 0)) throw httpError(kind === 'PERCENT' ? 'Nhập % giảm từ 1 đến 100' : 'Nhập số tiền giảm', 400);
  const weekdays = (Array.isArray(b.weekdays) ? b.weekdays : String(b.weekdays || '').split(',')).filter(d => d !== '' && d != null).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  const date = (v) => v ? new Date(v).toISOString() : null;
  const auto = kind === 'PERCENT' ? `Giảm ${percent}%` : kind === 'PER_SEAT' ? `Giảm ${discount.toLocaleString('vi-VN')} đ mỗi ghế` : `Giảm ${discount.toLocaleString('vi-VN')} đ`;
  const row = {
    kind, discount, percent, max_discount: money(b.max_discount), min_total: money(b.min_total), need_combo: b.need_combo === true || b.need_combo === 'true',
    weekdays: [...new Set(weekdays)].sort(), label: str(b.label, 120) || auto,
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

// ---- Phòng chiếu & sơ đồ ghế (Đợt 3) ----
const CLEAN_MIN = 15; // phút dọn phòng giữa hai suất
async function saveRoom(b) {
  const cinema = await Store.one('cinemas', { id: str(b.cinema_id) });
  if (!cinema) throw httpError('Chọn rạp', 400);
  const name = str(b.name, 60);
  if (name.length < 2) throw httpError('Nhập tên phòng (vd "Phòng 03 – IMAX")', 400);
  let layout;
  try { layout = b.layout_text != null ? Catalog.layoutFromText(b.layout_text) : Catalog.normLayout(b.layout); }
  catch (e) { throw httpError(e.message, 400); }
  const row = { cinema_id: cinema.id, name, layout, kind: str(b.kind, 30) || null, active: b.active !== false && b.active !== 'false' };
  const id = str(b.id);
  if (id) {
    const old = await Store.one('rooms', { id });
    if (!old) throw httpError('Không tìm thấy phòng', 404);
    // Không được xóa ghế đã có khách giữ / mua ở các suất sắp chiếu của phòng này
    const keep = new Set(Catalog.seatsOf(layout).map(s => s.id));
    const future = await Store.find('showtimes', { room_id: id, starts_at: { gte: new Date().toISOString() } }, { order: null, limit: 2000 });
    if (future.length) {
      const holds = await Store.find('seat_holds', { showtime_key: { in: future.map(s => s.id) } }, { order: null, limit: 20000 });
      const lost = [...new Set(holds.filter(h => !keep.has(h.seat_id)).map(h => h.seat_id))];
      if (lost.length) throw httpError('Sơ đồ mới bỏ mất ghế đã bán/giữ ở suất sắp chiếu: ' + lost.slice(0, 10).join(', '), 409);
    }
    const [u] = await Store.update('rooms', { id }, row);
    await Store.update('showtimes', { room_id: id }, { room: name });
    return u;
  }
  return Store.insert('rooms', row);
}

module.exports = { copyShowtimes, scheduleInsights, saveRoom, pricingOverview, saveTicketType, savePriceRule, deletePriceRule, saveHoliday, deleteHoliday, overview, saveMovie, saveCinema, createShowtimes, updateShowtime, saveVoucher };
