// lib/schedule-extend.js - Đợt 10h: tự gia hạn lịch chiếu (gọi từ /api/cron mỗi đêm).
// Giữ cho mỗi rạp luôn có lịch AUTO_SCHEDULE_DAYS ngày tới (mặc định 14; đặt 0 để tắt):
// ngày nào của rạp còn TRỐNG thì chép nguyên lịch của cùng thứ tuần trước (hoặc 2 tuần trước) – cùng giờ, phim,
// phòng, giá riêng. Không đụng tới ngày đã có suất (kể cả suất Quản lý tạm ngưng), bỏ suất đã ngưng / phim đã ẩn,
// rạp chưa từng có lịch thì không tự bịa ra lịch.
const Store = require('./store');
const CatalogDB = require('./catalog-db');

const DAY = 24 * 3600 * 1000;

function horizonDays() {
  const v = process.env.AUTO_SCHEDULE_DAYS;
  if (v == null || String(v).trim() === '') return 14;
  const n = Math.round(Number(v));
  return n > 0 ? Math.min(n, 31) : 0;
}

async function extend({ days = horizonDays(), now = new Date() } = {}) {
  if (!(days > 0)) return { enabled: false, created: 0 };
  const today = CatalogDB.vnParts(now.toISOString()).date;
  const from = CatalogDB.addDays(today, -14), to = CatalogDB.addDays(today, days);
  const [shows, movies, cinemas] = await Promise.all([
    Store.find('showtimes', { starts_at: { gte: CatalogDB.vnIso(from, '00:00'), lt: CatalogDB.vnIso(to, '00:00') } }, { order: null, limit: 50000 }),
    Store.find('movies', {}, { order: null, limit: 1000 }),
    Store.find('cinemas', {}, { order: null, limit: 500 })
  ]);
  const mv = Object.fromEntries(movies.map(m => [m.id, m]));
  // rạp -> ngày (giờ VN) -> suất
  const plan = {};
  for (const s of shows) {
    const d = CatalogDB.vnParts(s.starts_at).date;
    ((plan[s.cinema_id] = plan[s.cinema_id] || {})[d] = plan[s.cinema_id][d] || []).push(s);
  }
  const rows = [];
  const filled = [];
  for (const c of cinemas) {
    if (c.active === false || !plan[c.id]) continue;
    const byDate = plan[c.id];
    for (let i = 0; i < days; i++) {
      const date = CatalogDB.addDays(today, i);
      if (byDate[date] && byDate[date].length) continue;
      const back = [7, 14].find(k => (byDate[CatalogDB.addDays(date, -k)] || []).length);
      if (!back) continue;
      const made = [];
      for (const s of byDate[CatalogDB.addDays(date, -back)]) {
        const m = mv[s.movie_id];
        if (s.active === false || !m || m.status === 'HIDDEN') continue;
        const at = new Date(new Date(s.starts_at).getTime() + back * DAY); // Việt Nam không đổi giờ mùa hè: +7 ngày là đúng giờ cũ
        if (at <= now) continue;
        const p = CatalogDB.vnParts(at.toISOString());
        const row = { movie_id: s.movie_id, cinema_id: c.id, starts_at: CatalogDB.vnIso(p.date, p.time), format: s.format, room: s.room, room_id: s.room_id || null,
          price_standard: s.price_standard == null ? null : s.price_standard, price_vip: s.price_vip == null ? null : s.price_vip,
          price_sweetbox: s.price_sweetbox == null ? null : s.price_sweetbox, active: true };
        made.push(row);
      }
      if (!made.length) continue;
      byDate[date] = made; // ngày vừa lấp làm nguồn cho ngày sau 7 ngày nữa trong cùng lượt
      rows.push(...made);
      filled.push(c.id + ' ' + date);
    }
  }
  let created = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += 20) {
    const res = await Promise.allSettled(rows.slice(i, i + 20).map(r => Store.insert('showtimes', r)));
    for (const x of res) { if (x.status === 'fulfilled') created++; else if (errors.length < 5) errors.push(String((x.reason && x.reason.message) || x.reason).slice(0, 120)); }
  }
  return { enabled: true, days, created, days_filled: filled.length, errors };
}

module.exports = { extend, horizonDays };
