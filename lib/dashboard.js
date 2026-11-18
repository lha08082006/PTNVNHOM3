// lib/dashboard.js - Số liệu tổng quan cho Quản lý / Kế toán: doanh thu, vé bán, hoàn tiền, lấp đầy ghế
const Store = require('./store');
const CatalogDB = require('./catalog-db');

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
  let revenue = 0, tickets = 0;
  for (const o of orders) {
    const day = dayOf[CatalogDB.vnParts(o.confirmed_at || o.created_at).date];
    const n = (o.seats || []).length;
    revenue += o.total; tickets += n;
    if (day) { day.revenue += o.total; day.orders++; day.tickets += n; }
    const mk = o.movie_key || '?';
    byMovie[mk] = byMovie[mk] || { key: mk, title: movies[mk] || mk, revenue: 0, tickets: 0 };
    byMovie[mk].revenue += o.total; byMovie[mk].tickets += n;
    const ck = o.cinema || '?';
    byCinema[ck] = byCinema[ck] || { name: ck, revenue: 0, tickets: 0 };
    byCinema[ck].revenue += o.total; byCinema[ck].tickets += n;
  }
  const refunded = refunds.reduce((s, r) => s + Number(r.amount || 0), 0);

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
      occupancy_3d: totalSeats ? Math.round((soldSeats / totalSeats) * 100) : 0, pending_manual_refunds: pendingManual, open_tickets: openTickets },
    days,
    by_movie: Object.values(byMovie).sort((a, b) => b.revenue - a.revenue),
    by_cinema: Object.values(byCinema).sort((a, b) => b.revenue - a.revenue),
    upcoming: upcoming.sort((a, b) => b.rate - a.rate).slice(0, 20)
  };
}

module.exports = { build };
