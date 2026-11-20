// lib/backoffice.js - Công cụ cho Kế toán, CSKH và Quầy trong admin.html (Đợt 7)
//
// Kế toán : chỉ số tổng quan, bảng kê chuyển khoản hoàn tiền (CSV cho internet banking),
//           chốt sổ theo ngày (lưu ảnh chụp số liệu, báo "phát sinh sau chốt"), tiền vào không khớp đơn.
// CSKH    : nhận xử lý phiếu, ghi chú nội bộ, tra cứu khách hàng 360°, gửi lại vé cho khách.
// Quầy    : bảng suất chiếu hôm nay kèm tiến độ soát vé, phiếu bắp nước chờ nhận, số vé đã soát trong ca.
const Store = require('./store');
const Flow = require('./flow');
const CatalogDB = require('./catalog-db');
const Catalog = require('../catalog');

const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];
const WALLETS = ['VNPAY', 'MOMO', 'ZALOPAY'];
const OPEN_REFUND = ['REQUESTED', 'RETRYING', 'MANUAL_REVIEW', 'FORM_SUBMITTED', 'CS_APPROVED', 'ACC_RETURNED', 'PAID_OUT'];
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const iso = (d) => new Date(d).toISOString();
const sum = (rows, k = 'amount') => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
const vnDate = (d) => CatalogDB.vnParts(iso(d)).date;
const dayStart = (date) => CatalogDB.vnIso(date, '00:00');
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (head, rows) => '﻿' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
// Nội dung chuyển khoản không dấu (ngân hàng thường không nhận ký tự có dấu)
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim();

// ===================================================================== KẾ TOÁN
async function accountingSummary(now = new Date()) {
  const today = vnDate(now);
  const [pending, paidOut, done, invoices, unmatched, closings] = await Promise.all([
    Store.find('refunds', { status: 'CS_APPROVED' }, { order: null, limit: 1000 }),
    Store.find('refunds', { status: 'PAID_OUT' }, { order: null, limit: 1000 }),
    Store.find('refunds', { status: 'DONE', accounting_paid_at: { gte: dayStart(today) } }, { order: null, limit: 1000 }).catch(() => []),
    Store.find('invoice_requests', { status: 'PENDING' }, { order: null, limit: 1000 }).catch(() => []),
    unmatchedList({ days: 30 }),
    Store.find('day_closings', { date: { gte: CatalogDB.addDays(today, -7) } }, { order: null, limit: 20 }).catch(() => [])
  ]);
  const paidToday = paidOut.filter(r => r.accounting_paid_at && r.accounting_paid_at >= dayStart(today)).concat(done);
  const closed = new Set(closings.map(c => c.date));
  const unclosed = [];
  for (let i = 1; i <= 7; i++) { const d = CatalogDB.addDays(today, -i); if (!closed.has(d)) unclosed.push(d); }
  const openUnmatched = unmatched.filter(u => !u.resolved);
  return {
    pending_count: pending.length, pending_amount: sum(pending),
    paid_today_count: paidToday.length, paid_today_amount: sum(paidToday),
    invoices_pending: invoices.length,
    unmatched_count: openUnmatched.length, unmatched_amount: sum(openUnmatched),
    days_unclosed: unclosed
  };
}

// Bảng kê chuyển khoản hoàn tiền: Kế toán tải về, nhập vào internet banking (chuyển theo lô), rồi đánh dấu đã chi
async function payoutCsv(codes) {
  let rows = await Store.find('refunds', { status: 'CS_APPROVED' }, { order: 'created_at', asc: true, limit: 1000 });
  const want = (Array.isArray(codes) ? codes : []).map(String).filter(Boolean);
  if (want.length) rows = rows.filter(r => want.includes(r.code));
  if (!rows.length) throw httpError('Không có hồ sơ nào đang chờ chi', 400);
  return {
    count: rows.length, amount: sum(rows),
    csv: toCsv(['STT', 'Mã hồ sơ', 'Mã đơn', 'Ngân hàng', 'Số tài khoản', 'Tên chủ tài khoản', 'Số tiền', 'Nội dung chuyển khoản'],
      rows.map((r, i) => [i + 1, r.code, r.order_code, r.bank_name, r.acc_number, ascii(r.acc_name).toUpperCase(), r.amount, ascii(`HOAN TIEN ${r.code} DON ${r.order_code} BETA CINEMAS`)]))
  };
}

// Số liệu theo ngày (giờ VN) cho chốt sổ: tiền vào theo kênh, chưa khớp đơn, doanh thu xuất vé, hoàn tiền, chi hoàn thủ công
async function daySummaries(fromDate, toDate) {
  const from = dayStart(fromDate), to = dayStart(CatalogDB.addDays(toDate, 1));
  const [txs, orders, refundsDone, payouts, refundsNew] = await Promise.all([
    Store.find('bank_transactions', { transfer_type: 'in', transaction_date: { gte: from, lt: to } }, { order: null, limit: 50000 }),
    Store.find('orders', { status: { in: PAID }, confirmed_at: { gte: from, lt: to } }, { order: null, limit: 50000 }),
    Store.find('refunds', { status: 'DONE', done_at: { gte: from, lt: to } }, { order: null, limit: 50000 }),
    Store.find('refunds', { accounting_paid_at: { gte: from, lt: to } }, { order: null, limit: 50000 }),
    Store.find('refunds', { created_at: { gte: from, lt: to } }, { order: null, limit: 50000 })
  ]);
  const days = {};
  for (let d = fromDate; d <= toDate; d = CatalogDB.addDays(d, 1)) {
    days[d] = { date: d, received: 0, tx_count: 0, by_channel: { VIETQR: 0, VNPAY: 0, MOMO: 0, ZALOPAY: 0 }, unmatched: 0, unmatched_count: 0,
      revenue: 0, orders: 0, fnb_revenue: 0, refunded_auto: 0, refunded_manual: 0, payouts: 0, payouts_count: 0, refunds_open: 0 };
  }
  const at = (d) => days[vnDate(d)];
  for (const t of txs) {
    const x = at(t.transaction_date); if (!x) continue;
    const a = Number(t.amount || 0);
    x.received += a; x.tx_count++;
    x.by_channel[WALLETS.includes(t.gateway) ? t.gateway : 'VIETQR'] += a;
    if (t.result === 'UNMATCHED') { x.unmatched += a; x.unmatched_count++; }
  }
  for (const o of orders) { const x = at(o.confirmed_at); if (!x) continue; x.revenue += Number(o.total || 0); x.orders++; if (o.kind === 'FNB') x.fnb_revenue += Number(o.total || 0); }
  for (const r of refundsDone) { const x = at(r.done_at); if (x) x[r.is_manual ? 'refunded_manual' : 'refunded_auto'] += Number(r.amount || 0); }
  for (const r of payouts) { const x = at(r.accounting_paid_at); if (x) { x.payouts += Number(r.amount || 0); x.payouts_count++; } }
  for (const r of refundsNew) { const x = at(r.created_at); if (x && OPEN_REFUND.includes(r.status)) x.refunds_open += Number(r.amount || 0); }
  for (const x of Object.values(days)) x.net = x.received - x.refunded_auto - x.refunded_manual;
  return days;
}

// 14 ngày gần nhất: số liệu hiện tại + bản đã chốt. Chốt rồi mà số liệu đổi (webhook về trễ, hoàn tiền sau...) -> CHANGED
async function dayList(n = 14, now = new Date()) {
  const today = vnDate(now);
  const from = CatalogDB.addDays(today, -(n - 1));
  const live = await daySummaries(from, today);
  const closings = Object.fromEntries((await Store.find('day_closings', { date: { gte: from } }, { order: null, limit: 100 })).map(c => [c.date, c]));
  const KEYS = ['received', 'revenue', 'refunded_auto', 'refunded_manual', 'payouts', 'unmatched'];
  return Object.values(live).reverse().map(x => {
    const c = closings[x.date];
    const changed = c ? KEYS.filter(k => Number((c.summary || {})[k] || 0) !== Number(x[k] || 0)) : [];
    return { ...x, is_today: x.date === today, closing: c ? { closed_by: c.closed_by, closed_at: c.closed_at, note: c.note, summary: c.summary } : null,
      status: !c ? (x.date === today ? 'TODAY' : 'OPEN') : changed.length ? 'CHANGED' : 'CLOSED', changed };
  });
}

async function closeDay(date, note, staff, now = new Date()) {
  const d = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw httpError('Chọn ngày cần chốt', 400);
  if (d >= vnDate(now)) throw httpError('Chỉ chốt sổ được ngày đã kết thúc (từ hôm qua trở về trước)', 400);
  const summary = (await daySummaries(d, d))[d];
  try {
    return await Store.insert('day_closings', { id: d, date: d, summary, note: String(note || '').slice(0, 500) || null, closed_by: staff.full_name, closed_by_id: staff.id, closed_at: iso(now) });
  } catch (e) {
    if (e.code === '23505') throw httpError('Ngày ' + d + ' đã được chốt sổ', 409);
    throw e;
  }
}
async function reopenDay(date, reason) {
  if (String(reason || '').trim().length < 5) throw httpError('Ghi rõ lý do mở lại sổ (ít nhất 5 ký tự)', 400);
  const c = await Store.one('day_closings', { date: String(date) });
  if (!c) throw httpError('Ngày này chưa chốt sổ', 404);
  await Store.remove('day_closings', { date: String(date) });
  return { ok: true, date: c.date };
}
async function dayCsv(n = 31) {
  const rows = await dayList(n);
  const st = { OPEN: 'Chưa chốt', TODAY: 'Hôm nay', CLOSED: 'Đã chốt', CHANGED: 'Phát sinh sau chốt' };
  return toCsv(['Ngày', 'Tiền vào', 'VietQR', 'VNPay', 'MoMo', 'ZaloPay', 'Chưa khớp đơn', 'Doanh thu xuất vé', 'Trong đó bắp nước', 'Hoàn tự động', 'Hoàn thủ công', 'Tiền giữ lại', 'Kế toán đã chi', 'Hồ sơ hoàn đang mở', 'Trạng thái', 'Người chốt', 'Ghi chú'],
    rows.map(x => [x.date, x.received, x.by_channel.VIETQR, x.by_channel.VNPAY, x.by_channel.MOMO, x.by_channel.ZALOPAY, x.unmatched, x.revenue, x.fnb_revenue, x.refunded_auto, x.refunded_manual, x.net, x.payouts, x.refunds_open, st[x.status], x.closing ? x.closing.closed_by : '', x.closing ? x.closing.note : '']));
}

// Tiền vào không khớp mã đơn nào (khách ghi sai nội dung...) + phiếu CSKH tương ứng đã xử lý chưa
async function unmatchedList({ days = 30 } = {}) {
  const txs = await Store.find('bank_transactions', { result: 'UNMATCHED', transaction_date: { gte: iso(Date.now() - days * 864e5) } }, { order: 'transaction_date', limit: 500 });
  const tickets = await Store.find('support_tickets', { type: 'UNMATCHED_TX' }, { limit: 1000 });
  const byRef = {};
  for (const t of tickets) { const ref = t.context && t.context.transaction && t.context.transaction.reference_code; if (ref) byRef[ref] = t; }
  return txs.map(x => {
    const t = byRef[x.reference_code];
    return { reference_code: x.reference_code, amount: Number(x.amount || 0), transaction_date: x.transaction_date, content: x.content, gateway: x.gateway, account_number: x.account_number,
      ticket_code: t ? t.code : null, ticket_status: t ? t.status : null, ticket_note: t ? t.note : null, resolved: !!(t && t.status === 'RESOLVED') };
  });
}

// ===================================================================== CSKH
async function assignTicket(code, staff, release = false) {
  const t = await Store.one('support_tickets', { code: String(code || '') });
  if (!t) throw httpError('Không tìm thấy phiếu', 404);
  if (!release && t.assigned_to && t.assigned_to !== staff.id) throw httpError('Phiếu đang do ' + t.assigned_name + ' xử lý', 409);
  const [u] = await Store.update('support_tickets', { code: t.code }, release
    ? { assigned_to: null, assigned_name: null, assigned_at: null, updated_at: iso(Date.now()) }
    : { assigned_to: staff.id, assigned_name: staff.full_name, assigned_at: iso(Date.now()), updated_at: iso(Date.now()) });
  return u;
}
async function noteTicket(code, note, staff) {
  const n = String(note || '').trim().slice(0, 1000);
  if (n.length < 2) throw httpError('Nhập ghi chú', 400);
  const t = await Store.one('support_tickets', { code: String(code || '') });
  if (!t) throw httpError('Không tìm thấy phiếu', 404);
  const notes = [...(Array.isArray(t.internal_notes) ? t.internal_notes : []), { at: iso(Date.now()), name: staff.full_name, staff_id: staff.id, note: n }].slice(-100);
  const [u] = await Store.update('support_tickets', { code: t.code }, { internal_notes: notes, updated_at: iso(Date.now()) });
  return u;
}

// Tra cứu khách: mã đơn BC…, email, số điện thoại hoặc một phần họ tên (không phân biệt dấu)
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
const briefCustomer = (c) => ({ id: c.id, full_name: c.full_name, email: c.email, phone: c.phone, created_at: c.created_at, deleted: !!c.deleted_at, marketing_opt_in: !!c.marketing_opt_in });
async function customerSearch(q) {
  const s = String(q || '').trim();
  if (s.length < 3) throw httpError('Nhập ít nhất 3 ký tự (mã đơn, email, SĐT hoặc tên)', 400);
  const out = new Map();
  const add = (c) => { if (c) out.set(c.id, briefCustomer(c)); };
  const code = s.toUpperCase().match(/BC\d{10}/);
  if (code) { const o = await Store.one('orders', { code: code[0] }); if (o && o.user_id) add(await Store.one('customers', { id: o.user_id })); }
  if (/@/.test(s)) add(await Store.one('customers', { email: s.toLowerCase() }));
  const digits = s.replace(/[\s.-]/g, '');
  if (/^(0|\+84)\d{8,10}$/.test(digits)) add(await Store.one('customers', { phone: digits }));
  if (!out.size) {
    const f = fold(s);
    const all = await Store.find('customers', {}, { order: null, limit: 20000 });
    for (const c of all) if (!c.deleted_at && (fold(c.full_name).includes(f) || String(c.email || '').includes(s.toLowerCase()) || String(c.phone || '').includes(digits))) { add(c); if (out.size >= 20) break; }
  }
  return [...out.values()];
}

async function customerDetail(id) {
  const c = await Store.one('customers', { id: String(id || '') });
  if (!c) throw httpError('Không tìm thấy khách hàng', 404);
  const orders = await Store.find('orders', { user_id: c.id }, { limit: 100 });
  const codes = orders.map(o => o.code);
  const [refunds, ticketsMine, ticketsOrders, reviews, invoices, favorites] = await Promise.all([
    codes.length ? Store.find('refunds', { order_code: { in: codes } }, { limit: 200 }) : [],
    Store.find('support_tickets', { customer_id: c.id }, { limit: 100 }).catch(() => []),
    codes.length ? Store.find('support_tickets', { order_code: { in: codes } }, { limit: 100 }) : [],
    Store.find('movie_reviews', { customer_id: c.id }, { limit: 100 }).catch(() => []),
    Store.find('invoice_requests', { customer_id: c.id }, { limit: 100 }).catch(() => []),
    Store.find('favorites', { customer_id: c.id }, { limit: 200 }).catch(() => [])
  ]);
  const tickets = [...new Map(ticketsMine.concat(ticketsOrders).map(t => [t.code, t])).values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  let points = null;
  try { points = await require('./points').overview(c); } catch (e) { /* bảng điểm chưa có */ }
  const paid = orders.filter(o => PAID.includes(o.status));
  return {
    customer: { ...briefCustomer(c), birthday: c.birthday || null, terms_accepted_at: c.terms_accepted_at || null },
    stats: { orders: orders.length, paid_orders: paid.length, spend: sum(paid, 'total'), refunds: refunds.length, open_tickets: tickets.filter(t => t.status !== 'RESOLVED').length, favorites: favorites.length },
    points: points ? { balance: points.balance, tier: points.tier.label, spend_365: points.spend_365, expiring_soon: points.expiring_soon } : null,
    orders: orders.map(o => ({ code: o.code, status: o.status, label: Flow.STATUS_LABEL[o.status] || o.status, kind: o.kind || 'TICKET', total: o.total, movie_key: o.movie_key, cinema: o.cinema, show_date: o.show_date, show_time: o.show_time, seats: o.seats || [], created_at: o.created_at })),
    refunds: refunds.map(r => ({ code: r.code, order_code: r.order_code, status: r.status, amount: r.amount, reason: r.reason, created_at: r.created_at })),
    tickets: tickets.map(t => ({ code: t.code, type: t.type, status: t.status, summary: t.summary, order_code: t.order_code, created_at: t.created_at })),
    reviews: reviews.map(r => ({ movie_id: r.movie_id, rating: r.rating, content: r.content, hidden: r.hidden, created_at: r.created_at })),
    invoices: invoices.map(i => ({ order_code: i.order_code, status: i.status, company_name: i.company_name, tax_code: i.tax_code, invoice_no: i.invoice_no }))
  };
}

// Nhân viên gửi lại vé cho khách (vd khách gọi tổng đài báo mất email). Giới hạn 3 lần / 15 phút mỗi đơn như phía khách.
async function resendTicket(code, staff) {
  const Mailer = require('./mailer');
  const Throttle = require('./throttle');
  const order = await Store.one('orders', { code: String(code || '').toUpperCase() });
  if (!order) throw httpError('Không tìm thấy đơn', 404);
  if (!PAID.includes(order.status)) throw httpError('Đơn chưa xuất vé', 409);
  if (!order.email) throw httpError('Đơn không có email (khách đã xóa tài khoản hoặc chưa có email)', 409);
  await Throttle.check('m:' + order.code);
  await Throttle.fail('m:' + order.code, 3);
  const message = order.kind === 'FNB'
    ? `Phiếu bắp nước ${order.code} tại ${order.cinema}. Mở trang đơn hàng để xem mã QR nhận món.`
    : `Vé đơn ${order.code}: ${order.cinema || ''} · ${[order.show_time, order.show_date].filter(Boolean).join(' ')} · Ghế ${(order.seats || []).join(', ')}. Mở trang đơn hàng để xem mã QR soát vé.`;
  const r = await Mailer.send({ to: order.email, title: 'Vé điện tử Beta Cinemas – ' + order.code, message, orderCode: order.code });
  await Store.insert('notifications', { order_code: order.code, channel: 'EMAIL', event: 'TICKET_RESENT', title: 'Gửi lại vé điện tử (nhân viên ' + staff.full_name + ')', message,
    recipient: order.email + (r.sent ? ' (đã gửi)' : r.reason === 'not-configured' ? ' (chưa cấu hình gửi mail)' : ' (lỗi gửi)') }).catch(() => null);
  if (!r.sent && r.reason !== 'not-configured') throw httpError('Chưa gửi được email: ' + r.reason, 502);
  return { sent: !!r.sent, email: order.email.replace(/^(.).*(@.*)$/, '$1***$2') };
}

// ===================================================================== QUẦY
async function counterBoard(cinemaId, staff, now = new Date()) {
  const cinema = await Store.one('cinemas', { id: String(cinemaId || '') });
  if (!cinema) throw httpError('Chọn rạp làm việc', 400);
  const today = vnDate(now);
  const shows = await CatalogDB.showtimes({ cinema: cinema.id, date: today, includePast: true });
  const orders = shows.length ? await Store.find('orders', { showtime_key: { in: shows.map(s => s.id) }, status: { in: PAID } }, { order: null, limit: 20000 }) : [];
  const checks = orders.length ? await Store.find('ticket_checkins', { order_id: { in: orders.map(o => o.id) } }, { order: null, limit: 20000 }) : [];
  const checked = new Set(checks.map(c => c.order_id));
  const rows = shows.map(s => {
    const os = orders.filter(o => o.showtime_key === s.id);
    const seats = os.reduce((n, o) => n + (o.seats || []).length, 0);
    const inSeats = os.filter(o => checked.has(o.id)).reduce((n, o) => n + (o.seats || []).length, 0);
    const start = new Date(s.starts_at).getTime(), end = start + (((s.movie && s.movie.duration_min) || 120) * 60000);
    const phase = now.getTime() > end ? 'ENDED' : now.getTime() >= start ? 'PLAYING' : start - now.getTime() <= 30 * 60000 ? 'SOON' : 'LATER';
    return { id: s.id, time: s.time, end_time: s.end_time, movie: s.movie ? s.movie.title : s.movie_key, room: s.room, format: s.format, active: s.active,
      seats_total: s.seats_total, sold_seats: seats, orders: os.length, checked_orders: os.filter(o => checked.has(o.id)).length, checked_seats: inSeats, phase };
  });
  // Phiếu bắp nước đã thanh toán, chưa nhận, còn hạn 30 ngày
  const fnb = (await Store.find('orders', { kind: 'FNB', cinema: cinema.name, status: { in: PAID } }, { limit: 500 }))
    .filter(o => Date.now() - new Date(o.confirmed_at || o.created_at).getTime() < 30 * 864e5);
  const fnbChecked = fnb.length ? new Set((await Store.find('ticket_checkins', { order_id: { in: fnb.map(o => o.id) } }, { order: null, limit: 5000 })).map(c => c.order_id)) : new Set();
  const pickups = fnb.filter(o => !fnbChecked.has(o.id)).map(o => ({
    code: o.code, customer: String(o.customer_name || 'Khách').trim().split(/\s+/).pop(), paid_at: o.confirmed_at || o.created_at,
    items: Object.entries(o.combos || {}).filter(([, q]) => q > 0).map(([k, q]) => q + ' × ' + ((Catalog.COMBOS[k] || {}).name || k)).join(', ')
  }));
  const mine = staff ? await Store.find('ticket_checkins', { staff_id: staff.id, created_at: { gte: dayStart(today) } }, { order: null, limit: 5000 }) : [];
  return { cinema: { id: cinema.id, name: cinema.name }, date: today, showtimes: rows, pickups, my_checkins_today: mine.length,
    totals: { sold_seats: sum(rows, 'sold_seats'), checked_seats: sum(rows, 'checked_seats'), showtimes: rows.length } };
}

module.exports = { accountingSummary, payoutCsv, daySummaries, dayList, closeDay, reopenDay, dayCsv, unmatchedList, assignTicket, noteTicket, customerSearch, customerDetail, resendTicket, counterBoard, ascii };
