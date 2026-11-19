// lib/dashboard.js - Số liệu tổng quan cho Quản lý / Kế toán: doanh thu, vé bán, hoàn tiền, lấp đầy ghế
const Store = require('./store');
const CatalogDB = require('./catalog-db');
const Catalog = require('../catalog');

// Khung giờ suất chiếu (giờ VN) để so sánh doanh thu
const SLOTS = [['MORNING', 'Sáng (trước 12:00)', 0, 12], ['AFTERNOON', 'Chiều (12:00–17:00)', 12, 17], ['EVENING', 'Tối (17:00–22:00)', 17, 22], ['LATE', 'Khuya (từ 22:00)', 22, 24]];
const slotOf = (hhmm) => { const h = Number(String(hhmm || '').slice(0, 2)); return (SLOTS.find(s => h >= s[2] && h < s[3]) || SLOTS[2])[0]; };
const comboValue = (o) => Object.entries(o.combos || {}).reduce((s, [k, q]) => s + ((Catalog.COMBOS[k] || {}).price || 0) * Number(q || 0), 0);
const seatValue = (o) => Object.values(o.seat_prices || {}).reduce((s, v) => s + Number(v || 0), 0);

const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];

async function build({ from, to } = {}) {
  const today = CatalogDB.vnToday();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : CatalogDB.addDays(end, -13);
  const fromIso = CatalogDB.vnIso(start, '00:00');
  const toIso = CatalogDB.vnIso(CatalogDB.addDays(end, 1), '00:00');

  // Đơn đã xuất vé trong kỳ (theo thời điểm xác nhận)
  const orders = (await Store.find('orders', { status: { in: PAID } }, { order: null, limit: 50000 }))
    .filter(o => { const t = o.confirmed_at || o.created_at; return t >= fromIso && t < toIso; });
  const refunds = (await Store.find('refunds', { status: 'DONE' }, { order: null, limit: 50000 }))
    .filter(r => { const t = r.done_at || r.created_at; return t >= fromIso && t < toIso; });
  const movies = Object.fromEntries((await Store.find('movies', {}, { order: null, limit: 500 })).map(m => [m.id, m.title]));

  const days = [];
  for (let d = start; d <= end; d = CatalogDB.addDays(d, 1)) days.push({ date: d, revenue: 0, orders: 0, tickets: 0 });
  const dayOf = Object.fromEntries(days.map(d => [d.date, d]));
  const byMovie = {}, byCinema = {};
  const bySlot = Object.fromEntries(SLOTS.map(s => [s[0], { key: s[0], label: s[1], revenue: 0, tickets: 0, orders: 0 }]));
  const vouchers = {};
  const mix = { ticket: 0, fnb_with_ticket: 0, fnb_only: 0, discount: 0, points: 0 };
  let revenue = 0, tickets = 0;
  for (const o of orders) {
    // Cơ cấu doanh thu: giá niêm yết vé / bắp nước, phần giảm do voucher và do điểm Beta Club
    const sv = seatValue(o), cv = comboValue(o), pts = (Number(o.points_used) || 0) * Catalog.LOYALTY.POINT_VALUE;
    const disc = Math.max(0, sv + cv - pts - Number(o.total || 0));
    mix.points += pts; mix.discount += disc;
    if (o.kind === 'FNB') mix.fnb_only += cv; else { mix.ticket += sv; mix.fnb_with_ticket += cv; }
    if (o.voucher) {
      vouchers[o.voucher] = vouchers[o.voucher] || { code: o.voucher, uses: 0, discount: 0, revenue: 0 };
      vouchers[o.voucher].uses++; vouchers[o.voucher].discount += disc; vouchers[o.voucher].revenue += Number(o.total || 0);
    }
    if (o.kind !== 'FNB') { const sl = bySlot[slotOf(o.show_time)]; sl.revenue += o.total; sl.tickets += (o.seats || []).length; sl.orders++; }
    const day = dayOf[CatalogDB.vnParts(o.confirmed_at || o.created_at).date];
    const n = (o.seats || []).length;
    revenue += o.total; tickets += n;
    if (day) { day.revenue += o.total; day.orders++; day.tickets += n; }
    const mk = o.kind === 'FNB' ? '(bap-nuoc)' : (o.movie_key || '?');
    byMovie[mk] = byMovie[mk] || { key: mk, title: movies[mk] || (mk === '(bap-nuoc)' ? 'Bắp nước mua riêng' : mk), revenue: 0, tickets: 0 };
    byMovie[mk].revenue += o.total; byMovie[mk].tickets += n;
    const ck = o.cinema || '?';
    byCinema[ck] = byCinema[ck] || { name: ck, revenue: 0, tickets: 0 };
    byCinema[ck].revenue += o.total; byCinema[ck].tickets += n;
  }
  const refunded = refunds.reduce((s, r) => s + Number(r.amount || 0), 0);
  // Hoàn tiền theo lý do
  const REASON = require('./flow').REFUND_REASON_LABEL;
  const refundByReason = {};
  for (const r of refunds) { const k = r.reason || '?'; refundByReason[k] = refundByReason[k] || { reason: k, label: REASON[k] || k, count: 0, amount: 0 }; refundByReason[k].count++; refundByReason[k].amount += Number(r.amount || 0); }
  // Beta Club trong kỳ
  const ledger = (await Store.find('point_ledger', {}, { order: null, limit: 100000 })).filter(r => r.created_at >= fromIso && r.created_at < toIso);
  const pts = (k) => ledger.filter(r => r.kind === k).reduce((s, r) => s + Number(r.points || 0), 0);
  const loyalty = { earned: pts('EARN'), birthday: pts('BIRTHDAY'), redeemed: -pts('REDEEM') - pts('RETURN'), expired: -pts('EXPIRE') };
  // Lấp đầy các suất ĐÃ chiếu trong kỳ (ghế đã bán / tổng ghế)
  const past = (await CatalogDB.showtimes({ from: start, days: Math.min(62, Math.round((new Date(toIso) - new Date(fromIso)) / 864e5)), includePast: true }))
    .filter(s => new Date(s.starts_at) < new Date());
  const pastSeats = past.reduce((s, x) => s + x.seats_total, 0), pastSold = past.reduce((s, x) => s + (x.seats_total - x.seats_free), 0);
  const occByMovie = {};
  for (const s of past) { const k = s.movie ? s.movie.title : s.movie_key; occByMovie[k] = occByMovie[k] || { title: k, sold: 0, total: 0, shows: 0 }; occByMovie[k].sold += s.seats_total - s.seats_free; occByMovie[k].total += s.seats_total; occByMovie[k].shows++; }

  // Lấp đầy ghế các suất trong 3 ngày tới
  const upcoming = (await CatalogDB.showtimes({ from: today, days: 3 }))
    .map(s => ({ id: s.id, movie: s.movie ? s.movie.title : s.movie_key, cinema: s.cinema, date_label: s.date_label, time: s.time,
      sold: s.seats_total - s.seats_free, total: s.seats_total, rate: Math.round(((s.seats_total - s.seats_free) / s.seats_total) * 100) }));
  const totalSeats = upcoming.reduce((s, x) => s + x.total, 0);
  const soldSeats = upcoming.reduce((s, x) => s + x.sold, 0);

  const pendingManual = (await Store.find('refunds', { status: { in: ['FORM_SUBMITTED', 'ACC_RETURNED', 'CS_APPROVED', 'PAID_OUT'] } }, { order: null, limit: 5000 })).length;
  const openTickets = (await Store.find('support_tickets', { status: { neq: 'RESOLVED' } }, { order: null, limit: 5000 })).length;

  return {
    from: start, to: end,
    kpi: { revenue, orders: orders.length, tickets, refunded, net: revenue - refunded, avg_order: orders.length ? Math.round(revenue / orders.length) : 0,
      occupancy_3d: totalSeats ? Math.round((soldSeats / totalSeats) * 100) : 0, pending_manual_refunds: pendingManual, open_tickets: openTickets,
      occupancy_period: pastSeats ? Math.round((pastSold / pastSeats) * 100) : 0, refund_rate: revenue ? Math.round(refunded / revenue * 1000) / 10 : 0 },
    mix, loyalty,
    by_slot: Object.values(bySlot),
    vouchers: Object.values(vouchers).sort((a, b) => b.uses - a.uses),
    refunds_by_reason: Object.values(refundByReason).sort((a, b) => b.amount - a.amount),
    occupancy_by_movie: Object.values(occByMovie).map(x => ({ ...x, rate: x.total ? Math.round(x.sold / x.total * 100) : 0 })).sort((a, b) => b.rate - a.rate),
    days,
    by_movie: Object.values(byMovie).sort((a, b) => b.revenue - a.revenue),
    by_cinema: Object.values(byCinema).sort((a, b) => b.revenue - a.revenue),
    upcoming: upcoming.sort((a, b) => b.rate - a.rate).slice(0, 20)
  };
}

// Báo cáo Quản lý dạng CSV (mở bằng Excel): mỗi phần một bảng, cách nhau dòng trống
function toCsv(d) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const L = [];
  const table = (title, head, rows) => { L.push(esc(title)); L.push(head.map(esc).join(',')); rows.forEach(r => L.push(r.map(esc).join(','))); L.push(''); };
  const k = d.kpi;
  table('BÁO CÁO QUẢN LÝ BETA CINEMAS ' + d.from + ' → ' + d.to, ['Chỉ số', 'Giá trị'], [
    ['Doanh thu (đơn đã xuất vé)', k.revenue], ['Đã hoàn tiền', k.refunded], ['Doanh thu thuần', k.net], ['Tỷ lệ hoàn tiền (%)', k.refund_rate],
    ['Số đơn', k.orders], ['Số vé', k.tickets], ['Giá trị đơn trung bình', k.avg_order], ['Lấp đầy suất đã chiếu trong kỳ (%)', k.occupancy_period]]);
  table('CƠ CẤU DOANH THU (giá niêm yết)', ['Hạng mục', 'Số tiền'], [['Vé', d.mix.ticket], ['Bắp nước kèm vé', d.mix.fnb_with_ticket], ['Bắp nước mua riêng', d.mix.fnb_only], ['Giảm do voucher', -d.mix.discount], ['Trả bằng điểm Beta Club', -d.mix.points]]);
  table('THEO NGÀY', ['Ngày', 'Doanh thu', 'Đơn', 'Vé'], d.days.map(x => [x.date, x.revenue, x.orders, x.tickets]));
  table('THEO PHIM', ['Phim', 'Doanh thu', 'Vé'], d.by_movie.map(x => [x.title, x.revenue, x.tickets]));
  table('THEO RẠP', ['Rạp', 'Doanh thu', 'Vé'], d.by_cinema.map(x => [x.name, x.revenue, x.tickets]));
  table('THEO KHUNG GIỜ SUẤT CHIẾU', ['Khung giờ', 'Doanh thu', 'Đơn', 'Vé'], d.by_slot.map(x => [x.label, x.revenue, x.orders, x.tickets]));
  table('LẤP ĐẦY THEO PHIM (suất đã chiếu)', ['Phim', 'Số suất', 'Ghế bán', 'Tổng ghế', 'Lấp đầy (%)'], d.occupancy_by_movie.map(x => [x.title, x.shows, x.sold, x.total, x.rate]));
  table('VOUCHER', ['Mã', 'Lượt dùng', 'Tổng giảm', 'Doanh thu đơn có mã'], d.vouchers.map(x => [x.code, x.uses, x.discount, x.revenue]));
  table('HOÀN TIỀN THEO LÝ DO', ['Lý do', 'Số hồ sơ', 'Số tiền'], d.refunds_by_reason.map(x => [x.label, x.count, x.amount]));
  table('BETA CLUB (điểm)', ['Hạng mục', 'Điểm'], [['Tích từ đơn hàng', d.loyalty.earned], ['Quà sinh nhật', d.loyalty.birthday], ['Đã dùng (trừ phần hoàn lại)', d.loyalty.redeemed], ['Hết hạn', d.loyalty.expired]]);
  return '\ufeff' + L.join('\r\n');
}

module.exports = { build, toCsv, SLOTS };
