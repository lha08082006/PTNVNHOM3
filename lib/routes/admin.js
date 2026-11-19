// lib/routes/admin.js (phục vụ tại /api/admin) - Trang nội bộ: CSKH (hàng đợi MANUAL_REVIEW), Kế toán (chi hoàn + báo cáo đối soát),
// Quản lý (nhân sự, nhật ký, công cụ IT). Đăng nhập bằng tài khoản nhân viên riêng (lib/staff.js),
// mỗi thao tác kiểm tra quyền theo vai trò và được ghi vào audit_logs.
const Store = require('../store');
const Flow = require('../flow');
const Staff = require('../staff');
const CatalogAdmin = require('../catalog-admin');
const CatalogDB = require('../catalog-db');
const Ticket = require('../ticket');
const Dashboard = require('../dashboard');
const { fail, clean, adminKey } = require('../api-util');

const nowIso = () => new Date().toISOString();
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';

async function getRefund(code) {
  const rf = await Store.one('refunds', { code: clean(code) });
  if (!rf) throw Object.assign(new Error('Không tìm thấy hồ sơ hoàn tiền ' + code), { http: 404 });
  const order = await Store.one('orders', { id: rf.order_id });
  return { rf, order };
}

// Lý do Kế toán trả hồ sơ về nhân viên
const RETURN_REASONS = {
  WRONG_ACCOUNT: 'Sai số tài khoản / tên chủ tài khoản',
  AMOUNT_MISMATCH: 'Số tiền hoàn không khớp sổ cái ngân hàng',
  RECEIPT_UNCLEAR: 'Biên lai không rõ hoặc không khớp giao dịch',
  DUPLICATE: 'Nghi trùng với khoản đã hoàn trước đó',
  OTHER: 'Khác'
};

// Ghi thêm một dòng vào nhật ký vòng duyệt Nhân viên <-> Kế toán của hồ sơ (actor = nhân viên đăng nhập)
const logEntry = (rf, role, actor, act, note) =>
  [...(Array.isArray(rf.review_log) ? rf.review_log : []), { at: nowIso(), role, actor: actor.full_name, actor_id: actor.id, action: act, note: note || null }];

// Quyền cần cho từng thao tác (null = chỉ cần đăng nhập; 'staff.manage' / 'system' = chỉ Quản lý)
const NEED = {
  overview: 'refund.view', order: 'order.view', report: 'report.view', run_job: 'system',
  send_to_accounting: 'refund.send', decide: 'refund.decide', remind: 'refund.remind', confirm_done: 'refund.confirm',
  accounting_paid: 'refund.pay', accounting_reject: 'refund.return', resolve_ticket: 'ticket.resolve', ticket_reply: 'ticket.resolve', review_list: 'ticket.view', review_hide: 'ticket.resolve', event_list: 'ticket.view', event_update: 'ticket.resolve', invoice_list: 'report.view', invoice_issue: 'refund.pay', invoice_cancel: 'refund.pay',
  staff_list: 'staff.manage', staff_create: 'staff.manage', staff_update: 'staff.manage', audit: 'staff.manage',
  catalog: 'catalog.manage', pricing: 'catalog.manage', post_list: 'catalog.manage', post_save: 'catalog.manage', post_delete: 'catalog.manage', ticket_type_save: 'catalog.manage', price_rule_save: 'catalog.manage',
  price_rule_delete: 'catalog.manage', holiday_save: 'catalog.manage', holiday_delete: 'catalog.manage', movie_save: 'catalog.manage', cinema_save: 'catalog.manage', showtime_list: 'catalog.manage',
  showtime_create: 'catalog.manage', room_save: 'catalog.manage', showtime_update: 'catalog.manage', voucher_save: 'catalog.manage',
  checkin: 'ticket.checkin', dashboard: 'report.view',
  me: null, change_password: null
};

// Nhân viên gửi hồ sơ sang Kế toán (lần đầu hoặc gửi lại sau khi bị trả về)
async function sendToAccounting(rf, order, note, actor) {
  if (!['FORM_SUBMITTED', 'ACC_RETURNED'].includes(rf.status)) {
    throw Object.assign(new Error(rf.status === 'MANUAL_REVIEW' ? 'Khách chưa gửi RefundForm – chưa thể chuyển Kế toán' : 'Hồ sơ không ở bước chờ nhân viên'), { http: 409 });
  }
  const resend = rf.status === 'ACC_RETURNED';
  const [u] = await Store.update('refunds', { id: rf.id, status: rf.status }, {
    status: 'CS_APPROVED', cs_decision: 'CAN_HOAN_TIEN', cs_note: note || rf.cs_note || null, reconciled_at: nowIso(),
    review_log: logEntry(rf, 'NHÂN VIÊN', actor, resend ? 'Gửi lại Kế toán' : 'Gửi Kế toán', note)
  });
  if (!u) throw Object.assign(new Error('Hồ sơ vừa được người khác xử lý'), { http: 409 });
  await Flow.addHistory(order, `Nhân viên (${actor.full_name}) ${resend ? 'gửi lại' : 'gửi'} hồ sơ ${rf.code} sang Kế toán chi hoàn ${vnd(rf.amount)}`);
  await syncTickets(order, u, { status: 'WAITING_ACCOUNTING', decision: 'CAN_HOAN_TIEN' });
  return u;
}

async function syncTickets(order, refund, patch) {
  const context = await Flow.buildContext(order, refund);
  for (const t of await Store.find('support_tickets', { order_code: order.code, status: { neq: 'RESOLVED' } })) {
    await Store.update('support_tickets', { id: t.id }, { ...patch, context, updated_at: nowIso() });
  }
}

// NFR-14: cảnh báo khi API đối tác lỗi liên tiếp từ 3 lần
async function alerts() {
  const out = [];
  const logs = await Store.find('gateway_logs', { api: { in: ['QUERY_STATUS', 'REFUND'] } }, { limit: 200 });
  for (const api of ['QUERY_STATUS', 'REFUND']) {
    let streak = 0;
    for (const l of logs.filter(x => x.api === api)) { if (l.result === 'ERROR') streak++; else break; }
    if (streak >= Flow.CONFIG.ALERT_CONSECUTIVE_ERRORS) {
      out.push({ level: 'danger', text: `${api === 'REFUND' ? 'Refund API' : 'Query Status API'} lỗi ${streak} lần liên tiếp – kiểm tra kết nối/token đối tác` });
    }
  }
  const retrying = await Store.find('refunds', { status: 'RETRYING' });
  if (retrying.length) out.push({ level: 'warn', text: `${retrying.length} lệnh hoàn đang chờ gửi lại theo chu kỳ Job 30 phút` });
  const expired = await Store.find('orders', { status: 'EXPIRED' });
  if (expired.length) out.push({ level: 'info', text: `${expired.length} đơn EXPIRED trong ScanList đang chờ Job đối soát` });
  return out;
}

const GROUP = {
  CONFIRMED: 'Khớp thành công', CONFIRMED_LATE: 'Cấp vé bù', AUTO: 'Đã hoàn tự động', MANUAL: 'Đã hoàn thủ công',
  PENDING_FIX: 'Còn lệch – chờ xử lý', UNMATCHED: 'Tiền không khớp đơn'
};

// REQ-05 / BR-12 / BR-13
async function report(from, to) {
  const orders = await Store.find('orders', { created_at: { gte: from, lte: to } }, { limit: 5000, asc: true });
  const rows = [];
  for (const o of orders) {
    const txs = await Store.find('bank_transactions', { code: o.code, transfer_type: 'in' }, { asc: true });
    const received = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
    if (!received && ['CANCELLED', 'PENDING', 'EXPIRED'].includes(o.status)) continue;
    const refunds = await Store.find('refunds', { order_code: o.code });
    const refunded = refunds.filter(r => r.status === 'DONE').reduce((s, r) => s + Number(r.amount || 0), 0);
    const refundOpen = refunds.filter(r => r.status !== 'DONE').reduce((s, r) => s + Number(r.amount || 0), 0);
    const revenue = ['CONFIRMED', 'CONFIRMED_LATE'].includes(o.status) ? o.total : 0;
    const diff = received - refunded - revenue;
    let group;
    if (o.status === 'REFUNDED') group = refunds.some(r => r.status === 'DONE' && r.is_manual) ? GROUP.MANUAL : GROUP.AUTO;
    else if (o.status === 'CONFIRMED') group = GROUP.CONFIRMED;
    else if (o.status === 'CONFIRMED_LATE') group = GROUP.CONFIRMED_LATE;
    else group = GROUP.PENDING_FIX;
    const mismatch = diff !== 0;
    if (mismatch && group !== GROUP.PENDING_FIX && refundOpen === 0) group = GROUP.PENDING_FIX;
    rows.push({
      code: o.code, status: o.status, group, total: o.total, revenue, received, refunded, refund_open: refundOpen, diff,
      flag: mismatch ? (refundOpen >= diff && diff > 0 ? 'CHỜ HOÀN' : 'LỆCH') : '',
      tx_refs: txs.map(t => t.reference_code).join(' '), tx_time: txs[0] ? txs[0].transaction_date : '', created_at: o.created_at
    });
  }
  const unmatched = await Store.find('bank_transactions', { result: 'UNMATCHED', transaction_date: { gte: from, lte: to } });
  for (const t of unmatched) {
    rows.push({ code: '(không có mã đơn)', status: 'UNMATCHED', group: GROUP.UNMATCHED, total: 0, revenue: 0, received: t.amount,
      refunded: 0, refund_open: 0, diff: t.amount, flag: 'LỆCH', tx_refs: t.reference_code, tx_time: t.transaction_date, created_at: t.created_at });
  }
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const byGroup = {};
  for (const r of rows) { byGroup[r.group] = byGroup[r.group] || { count: 0, received: 0 }; byGroup[r.group].count++; byGroup[r.group].received += r.received; }
  return { from, to, rows, summary: { orders: rows.length, revenue: sum('revenue'), received: sum('received'), refunded: sum('refunded'), refund_open: sum('refund_open'), flagged: rows.filter(r => r.flag).length, byGroup } };
}

function toCsv(rep) {
  const head = ['Mã đơn', 'Trạng thái', 'Nhóm đối soát', 'Giá trị đơn', 'Doanh thu vé', 'Tiền thực nhận', 'Đã hoàn', 'Đang chờ hoàn', 'Chênh lệch', 'Cảnh báo', 'Mã GD ngân hàng', 'Thời điểm GD', 'Thời điểm tạo đơn'];
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head.join(',')];
  for (const r of rep.rows) lines.push([r.code, r.status, r.group, r.total, r.revenue, r.received, r.refunded, r.refund_open, r.diff, r.flag, r.tx_refs, r.tx_time, r.created_at].map(esc).join(','));
  lines.push('');
  lines.push(['TỔNG', '', '', '', rep.summary.revenue, rep.summary.received, rep.summary.refunded, rep.summary.refund_open, '', rep.summary.flagged + ' dòng cảnh báo'].map(esc).join(','));
  return '﻿' + lines.join('\r\n');
}

module.exports = async function handler(req, res) {
  const action = clean((req.query && req.query.action) || (req.body && req.body.action));
  const b0 = req.body || {};
  try {
    await Staff.seedDemo();

    // --- Công khai: trạng thái hệ thống, đăng nhập, tạo Quản lý đầu tiên ---
    if (action === 'status') {
      return res.status(200).json({ ok: true, live_db: Store.isLive(), needs_bootstrap: (await Staff.count()) === 0, roles: Staff.ROLES });
    }
    if (req.method === 'POST' && action === 'login') {
      const r = await Staff.login(b0.email, b0.password);
      await Staff.audit(r.staff, 'login', null);
      return res.status(200).json({ ok: true, ...r });
    }
    // Chỉ khi CHƯA có nhân viên nào: dùng ADMIN_KEY để tạo tài khoản Quản lý đầu tiên
    if (req.method === 'POST' && action === 'bootstrap') {
      if (await Staff.count()) return res.status(409).json({ ok: false, error: 'Đã có tài khoản nhân viên – hãy đăng nhập' });
      const key = adminKey();
      if (!key || String(b0.admin_key || '') !== key) return res.status(401).json({ ok: false, error: 'Sai khóa ADMIN_KEY' });
      const created = await Staff.create({ email: b0.email, full_name: b0.full_name, role: 'MANAGER', password: b0.password });
      await Staff.audit(null, 'bootstrap_manager', created.email);
      return res.status(200).json({ ok: true, staff: created });
    }

    if (!(action in NEED)) return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
    const me = await Staff.guard(req, res, NEED[action]);
    if (!me) return;

    // Mọi thao tác ghi (POST) thành công đều vào nhật ký. Ghi xong (await) mới trả phản hồi, để
    // serverless không dừng tiến trình giữa chừng; ghi lỗi thì báo kèm `audit_warning`, không nuốt im lặng.
    // (Mọi nhánh dưới đây đều `return res...json(...)` nên handler chờ được promise này.)
    if (req.method === 'POST' && action !== 'change_password') {
      const json = res.json.bind(res);
      let statusCode = 200;
      const status = res.status.bind(res);
      res.status = (c) => { statusCode = c; return status(c); };
      res.json = async (data) => {
        if (statusCode < 400) {
          const target = b0.qr ? String(b0.qr).split('.')[1] : b0.code || b0.order_code || b0.title || b0.name || b0.movie_id || b0.refund_code || (Array.isArray(b0.refund_codes) ? b0.refund_codes.join(',') : null) || b0.ticket_code || b0.email || b0.id || null;
          const ok = await Staff.audit(me, action, target, { note: b0.note || undefined, reason: b0.reason || undefined, refund_ref: b0.refund_ref || undefined, role: b0.role || undefined, active: b0.active });
          if (!ok && data && typeof data === 'object') data = { ...data, audit_warning: 'Thao tác đã thực hiện nhưng chưa ghi được nhật ký – báo IT kiểm tra' };
        }
        return json(data);
      };
    }

    if (req.method === 'GET' && action === 'me') return res.status(200).json({ ok: true, staff: Staff.publicStaff(me) });
    if (req.method === 'POST' && action === 'change_password') {
      await Staff.changeOwnPassword(me, b0.current_password, b0.new_password);
      await Staff.audit(me, 'change_password', me.email);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET' && action === 'dashboard') {
      if (req.query.format === 'csv') {
        const d = await Dashboard.build({ from: clean(req.query.from), to: clean(req.query.to) });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-quan-ly_${d.from}_${d.to}.csv"`);
        res.statusCode = 200;
        return res.end(Dashboard.toCsv(d));
      }
      return res.status(200).json({ ok: true, ...(await Dashboard.build({ from: clean(req.query.from), to: clean(req.query.to) })) });
    }

    // --- Quầy: soát vé (QR ký số hoặc mã đơn) ---
    if (req.method === 'POST' && action === 'checkin') {
      try {
        const summary = await Ticket.checkin(b0.qr || b0.code, me);
        return res.status(200).json({ ok: true, summary });
      } catch (e) {
        if (e.summary) return res.status(e.http || 409).json({ ok: false, error: e.message, summary: e.summary, already: !!e.already });
        throw e;
      }
    }

    // --- Quản lý: danh mục phim / rạp / suất chiếu / voucher ---
    if (req.method === 'GET' && action === 'catalog') return res.status(200).json({ ok: true, ...(await CatalogAdmin.overview()) });
    if (req.method === 'GET' && action === 'showtime_list') {
      const q = req.query || {};
      return res.status(200).json({ ok: true, showtimes: await CatalogDB.showtimes({ cinema: clean(q.cinema) || undefined, date: clean(q.date) || undefined, includePast: true, includeInactive: true }) });
    }
    // Hóa đơn điện tử (Đợt 4): Kế toán xem yêu cầu, xuất CSV, nhập số hóa đơn đã xuất
    if (req.method === 'GET' && action === 'invoice_list') {
      const EI = require('../einvoice');
      const rows = await EI.list({ status: clean(req.query.status) || undefined });
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="yeu-cau-hoa-don_${new Date().toISOString().slice(0, 10)}.csv"`);
        res.statusCode = 200;
        return res.end(EI.toCsv(rows));
      }
      return res.status(200).json({ ok: true, requests: rows, statuses: EI.STATUS, provider: EI.provider(), hours: EI.hours() });
    }
    if (req.method === 'POST' && action === 'invoice_issue') return res.status(200).json({ ok: true, request: await require('../einvoice').issue(b0, me) });
    if (req.method === 'POST' && action === 'invoice_cancel') return res.status(200).json({ ok: true, request: await require('../einvoice').cancel(b0, me) });
    // Thuê rạp / vé nhóm / Private Show (Đợt 3)
    if (req.method === 'GET' && action === 'event_list') {
      const E = require('../events');
      return res.status(200).json({ ok: true, requests: await E.adminList({ status: clean(req.query.status) || undefined }), kinds: E.KINDS, statuses: E.STATUS });
    }
    if (req.method === 'POST' && action === 'event_update') return res.status(200).json({ ok: true, request: await require('../events').update(b0, me) });
    // Đánh giá phim (Đợt 2): CSKH / Quản lý ẩn đánh giá vi phạm
    if (req.method === 'GET' && action === 'review_list') return res.status(200).json({ ok: true, reviews: await require('../reviews').adminList(req.query || {}) });
    if (req.method === 'POST' && action === 'review_hide') return res.status(200).json({ ok: true, review: await require('../reviews').setHidden(clean(b0.id), b0.hidden !== false, me) });
    if (req.method === 'GET' && action === 'post_list') return res.status(200).json({ ok: true, posts: await require('../posts').adminList(), types: require('../posts').TYPES });
    if (req.method === 'POST' && action === 'post_save') return res.status(200).json({ ok: true, post: await require('../posts').save(b0) });
    if (req.method === 'POST' && action === 'post_delete') return res.status(200).json(await require('../posts').remove(b0.id));
    if (req.method === 'GET' && action === 'pricing') return res.status(200).json({ ok: true, ...(await CatalogAdmin.pricingOverview()) });
    if (req.method === 'POST' && action === 'ticket_type_save') return res.status(200).json({ ok: true, ticket_type: await CatalogAdmin.saveTicketType(b0) });
    if (req.method === 'POST' && action === 'price_rule_save') return res.status(200).json({ ok: true, rule: await CatalogAdmin.savePriceRule(b0) });
    if (req.method === 'POST' && action === 'price_rule_delete') return res.status(200).json(await CatalogAdmin.deletePriceRule(b0.id));
    if (req.method === 'POST' && action === 'holiday_save') return res.status(200).json({ ok: true, holiday: await CatalogAdmin.saveHoliday(b0) });
    if (req.method === 'POST' && action === 'holiday_delete') return res.status(200).json(await CatalogAdmin.deleteHoliday(b0.date));
    if (req.method === 'POST' && action === 'movie_save') return res.status(200).json({ ok: true, movie: await CatalogAdmin.saveMovie(b0) });
    if (req.method === 'POST' && action === 'cinema_save') return res.status(200).json({ ok: true, cinema: await CatalogAdmin.saveCinema(b0) });
    if (req.method === 'POST' && action === 'room_save') return res.status(200).json({ ok: true, room: await CatalogAdmin.saveRoom(b0) });
    if (req.method === 'POST' && action === 'showtime_create') return res.status(200).json({ ok: true, ...(await CatalogAdmin.createShowtimes(b0)) });
    if (req.method === 'POST' && action === 'showtime_update') return res.status(200).json({ ok: true, showtime: await CatalogAdmin.updateShowtime(b0) });
    if (req.method === 'POST' && action === 'voucher_save') return res.status(200).json({ ok: true, voucher: await CatalogAdmin.saveVoucher(b0) });

    // --- Quản lý: nhân sự & nhật ký ---
    if (req.method === 'GET' && action === 'staff_list') {
      const rows = await Store.find('staff', {}, { order: 'created_at', asc: true, limit: 500 });
      return res.status(200).json({ ok: true, staff: rows.map(Staff.publicStaff), roles: Staff.ROLES });
    }
    if (req.method === 'POST' && action === 'staff_create') {
      return res.status(200).json({ ok: true, staff: await Staff.create(b0) });
    }
    if (req.method === 'POST' && action === 'staff_update') {
      return res.status(200).json({ ok: true, staff: await Staff.update(clean(b0.id), { full_name: b0.full_name, role: b0.role, active: b0.active, password: b0.password || undefined }, me) });
    }
    if (req.method === 'GET' && action === 'audit') {
      return res.status(200).json({ ok: true, logs: await Store.find('audit_logs', {}, { limit: 300 }) });
    }
    if (req.method === 'GET' && action === 'overview') {
      const tickets = await Store.find('support_tickets', { status: { neq: 'RESOLVED' } }, { limit: 200 });
      const pipeline = await Store.find('refunds', { status: { in: ['MANUAL_REVIEW', 'FORM_SUBMITTED', 'CS_APPROVED', 'ACC_RETURNED', 'PAID_OUT', 'RETRYING', 'REQUESTED'] } }, { limit: 300 });
      // Hồ sơ thủ công đã hoàn tất gần đây (bộ lọc "Hoàn tất")
      pipeline.push(...await Store.find('refunds', { status: 'DONE', is_manual: true }, { limit: 50 }));
      // Kế toán cần thấy tiền thực nhận của đơn để đối chiếu với số tiền hoàn
      for (const r of pipeline.filter(x => x.status === 'CS_APPROVED')) {
        const txs = await Store.find('bank_transactions', { code: r.order_code, transfer_type: 'in' }, { order: null });
        r.received = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
      }
      const orders = await Store.find('orders', {}, { limit: 40 });
      const logs = await Store.find('gateway_logs', {}, { limit: 60 });
      return res.status(200).json({
        ok: true, live_db: Store.isLive(), me: Staff.publicStaff(me), config: Flow.CONFIG, schedule: Flow.TIER1_SCHEDULE,
        alerts: await alerts(),
        tickets: tickets.map(t => ({ ...t, context: undefined, has_context: !!t.context })),
        refunds: pipeline.map(r => ({ ...r, receipt_url: undefined, has_receipt: !!r.receipt_url })),
        return_reasons: RETURN_REASONS,
        orders: orders.map(o => ({ code: o.code, status: o.status, label: Flow.STATUS_LABEL[o.status], total: o.total, paid_amount: o.paid_amount, created_at: o.created_at, seats: o.seats, movie_key: o.movie_key })),
        logs
      });
    }

    if (req.method === 'GET' && action === 'order') {
      const code = clean(req.query.code).toUpperCase();
      const order = await Store.one('orders', { code });
      if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn ' + code });
      const refunds = await Store.find('refunds', { order_code: code }, { asc: true });
      return res.status(200).json({
        ok: true, view: await Flow.view(order), context: await Flow.buildContext(order),
        refunds, tickets: await Store.find('support_tickets', { order_code: code }),
        logs: await Store.find('gateway_logs', { order_code: code }, { limit: 100 }),
        transactions: await Store.find('bank_transactions', { code }, { asc: true }),
        notifications: await Store.find('notifications', { order_code: code }, { limit: 100 })
      });
    }

    if (req.method === 'GET' && action === 'report') {
      const from = req.query.from ? new Date(req.query.from + 'T00:00:00+07:00').toISOString() : new Date(Date.now() - 24 * 3600e3).toISOString();
      const to = req.query.to ? new Date(req.query.to + 'T23:59:59+07:00').toISOString() : nowIso();
      const rep = await report(from, to);
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="doi-soat_${String(req.query.from || 'hom-nay')}_${String(req.query.to || '')}.csv"`);
        res.statusCode = 200;
        return res.end(toCsv(rep));
      }
      return res.status(200).json({ ok: true, ...rep });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const b = req.body || {};

    if (action === 'run_job') {
      return res.status(200).json({ ok: true, ...(await Flow.runJob({ force: !!b.force })) });
    }

    // Nhân viên gửi NHIỀU hồ sơ sang Kế toán một lần (lọc ở màn hình "Hoàn tiền thủ công")
    if (action === 'send_to_accounting') {
      const actor = me;
      const codes = (Array.isArray(b.refund_codes) ? b.refund_codes : []).map(clean).filter(Boolean).slice(0, 100);
      if (!codes.length) return res.status(400).json({ error: 'Chưa chọn hồ sơ nào' });
      const results = [];
      for (const code of codes) {
        try {
          const { rf, order } = await getRefund(code);
          await sendToAccounting(rf, order, clean(b.note).slice(0, 500), actor);
          results.push({ code, ok: true });
        } catch (e) {
          results.push({ code, ok: false, error: e.message });
        }
      }
      return res.status(200).json({ ok: true, sent: results.filter(r => r.ok).length, results });
    }

    // Kế toán kiểm tra lại: KHÔNG ĐẠT -> trả hồ sơ về nhân viên kèm lý do
    if (action === 'accounting_reject') {
      const actor = me;
      const { rf, order } = await getRefund(b.refund_code);
      const reason = RETURN_REASONS[clean(b.reason)];
      if (!reason) return res.status(400).json({ error: 'Chọn lý do trả về' });
      const note = clean(b.note).slice(0, 500);
      if (clean(b.reason) === 'OTHER' && !note) return res.status(400).json({ error: 'Ghi rõ lý do khi chọn "Khác"' });
      const accNote = reason + (note ? ': ' + note : '');
      const [u] = await Store.update('refunds', { id: rf.id, status: 'CS_APPROVED' }, {
        status: 'ACC_RETURNED', acc_note: accNote, acc_returned_at: nowIso(), returned_count: (rf.returned_count || 0) + 1,
        reconciled_at: null, review_log: logEntry(rf, 'KẾ TOÁN', actor, 'Trả về nhân viên', accNote)
      });
      if (!u) return res.status(409).json({ error: 'Hồ sơ không ở bước chờ Kế toán (có thể đã được xử lý)' });
      await Flow.addHistory(order, `Kế toán (${actor.full_name}) trả hồ sơ ${rf.code} về nhân viên: ${accNote}`);
      await syncTickets(order, u, { status: 'OPEN', decision: 'ACC_RETURNED' });
      return res.status(200).json({ ok: true, refund: u });
    }

    // CSKH đối chiếu RefundForm với log cổng thanh toán (SOP 6.5.1, bước 2)
    if (action === 'decide') {
      const { rf, order } = await getRefund(b.refund_code);
      if (!['FORM_SUBMITTED', 'MANUAL_REVIEW', 'ACC_RETURNED'].includes(rf.status)) return res.status(409).json({ error: 'Hồ sơ không ở bước chờ CSKH đối chiếu' });
      const note = clean(b.note).slice(0, 500);
      if (b.decision === 'CAN_HOAN_TIEN') {
        if (!Staff.can(me, 'refund.send')) return res.status(403).json({ error: 'Vai trò này không được gửi hồ sơ sang Kế toán' });
        const u = await sendToAccounting(rf, order, note, me);
        return res.status(200).json({ ok: true, refund: u });
      }
      if (b.decision === 'NGOAI_LE') {
        const [u] = await Store.update('refunds', { id: rf.id }, {
          status: 'MANUAL_REVIEW', cs_decision: 'NGOAI_LE', cs_note: note || 'Thông tin chưa đầy đủ hoặc ảnh biên lai không rõ',
          review_log: logEntry(rf, 'NHÂN VIÊN', me, 'Yêu cầu khách bổ sung', note)
        });
        await Flow.addHistory(order, 'CSKH: thông tin RefundForm chưa hợp lệ (NGOAI_LE) – nhắc khách cập nhật');
        await Flow.notify(order, 'REFUND_FORM', 'Vui lòng cập nhật biểu mẫu hoàn tiền',
          `CSKH cần bạn cập nhật lại thông tin nhận hoàn tiền cho đơn ${order.code}: ${u.cs_note}`);
        await syncTickets(order, u, { status: 'WAITING_CUSTOMER', decision: 'NGOAI_LE' });
        return res.status(200).json({ ok: true, refund: u });
      }
      return res.status(400).json({ error: 'decision phải là CAN_HOAN_TIEN hoặc NGOAI_LE' });
    }

    if (action === 'remind') {
      const { rf, order } = await getRefund(b.refund_code);
      await Flow.notify(order, 'REFUND_FORM', 'Nhắc: bổ sung thông tin nhận hoàn tiền',
        `Đơn ${order.code} đang chờ bạn điền biểu mẫu nhận hoàn ${vnd(rf.amount)}. Vào mục Theo dõi đơn hàng để hoàn tất.`, ['EMAIL', 'SMS', 'WEB']);
      return res.status(200).json({ ok: true });
    }

    // Kế toán chi hoàn thủ công (SOP 6.5.2)
    if (action === 'accounting_paid') {
      const { rf, order } = await getRefund(b.refund_code);
      const ref = clean(b.refund_ref).slice(0, 40);
      if (!ref) return res.status(400).json({ error: 'Nhập mã giao dịch chuyển hoàn' });
      const actor = me;
      // Nguyên tắc 2 người: người gửi hồ sơ sang Kế toán không được tự duyệt chi
      const lastSend = (rf.review_log || []).filter(l => l.role === 'NHÂN VIÊN').pop();
      if (lastSend && lastSend.actor_id === me.id) return res.status(403).json({ error: 'Bạn là người gửi hồ sơ này – cần một Kế toán khác duyệt chi' });
      const [u] = await Store.update('refunds', { id: rf.id, status: 'CS_APPROVED' }, {
        status: 'PAID_OUT', refund_ref: ref, approved_at: nowIso(), accounting_paid_at: nowIso(),
        review_log: logEntry(rf, 'KẾ TOÁN', actor, 'Đạt – đã chi', 'Mã GD ' + ref)
      });
      if (!u) return res.status(409).json({ error: 'Hồ sơ chưa được CSKH duyệt (CAN_HOAN_TIEN) hoặc đã chi' });
      await Flow.addHistory(order, `Kế toán (${actor.full_name}) đã chi hoàn thủ công ${vnd(rf.amount)} (mã GD ${ref}) – chờ CSKH xác nhận hoàn tất`);
      await syncTickets(order, u, { status: 'OPEN' });
      return res.status(200).json({ ok: true, refund: u });
    }

    // CSKH xác nhận hoàn tất -> REFUNDED (isManual = true) + thông báo kết quả cuối
    if (action === 'confirm_done') {
      const { rf, order } = await getRefund(b.refund_code);
      const [u] = await Store.update('refunds', { id: rf.id, status: 'PAID_OUT' }, { status: 'DONE', is_manual: true, done_at: nowIso() });
      if (!u) return res.status(409).json({ error: 'Kế toán chưa xác nhận đã chi hoàn' });
      let o = order;
      if (order.status === 'MANUAL_REVIEW') o = (await Flow.transition(order, 'REFUNDED', {}, `Hoàn tiền thủ công hoàn tất (isManual = true, mã GD ${u.refund_ref})`)) || order;
      else o = await Flow.addHistory(order, `Hoàn tiền thủ công hoàn tất ${vnd(u.amount)}`);
      await Flow.notify(o, 'REFUNDED', 'Hoàn tiền thành công',
        `Beta Cinemas đã hoàn ${vnd(u.amount)} cho đơn ${o.code} về tài khoản ${u.bank_name} ${Flow.maskAcc(u.acc_number)} (mã GD ${u.refund_ref}).`);
      await syncTickets(o, u, { status: 'RESOLVED', decision: 'DONE' });
      return res.status(200).json({ ok: true, refund: u });
    }

    // CSKH trả lời khách trên phiếu (khách thấy ở support.html > Phiếu hỗ trợ của tôi)
    if (action === 'ticket_reply') {
      const t = await Store.one('support_tickets', { code: clean(b.ticket_code) });
      if (!t) return res.status(404).json({ error: 'Không tìm thấy ticket' });
      const message = clean(b.message).slice(0, 1000);
      if (message.length < 2) return res.status(400).json({ error: 'Nhập nội dung trả lời' });
      const replies = [...(Array.isArray(t.replies) ? t.replies : []), { at: nowIso(), from: 'STAFF', name: me.full_name, staff_id: me.id, message }].slice(-100);
      const [u] = await Store.update('support_tickets', { code: t.code }, { replies, status: b.close ? 'RESOLVED' : 'WAITING_CUSTOMER', updated_at: nowIso() });
      return res.status(200).json({ ok: true, ticket: u });
    }

    if (action === 'resolve_ticket') {
      const [t] = await Store.update('support_tickets', { code: clean(b.ticket_code) }, { status: 'RESOLVED', note: clean(b.note).slice(0, 500), updated_at: nowIso() });
      if (!t) return res.status(404).json({ error: 'Không tìm thấy ticket' });
      return res.status(200).json({ ok: true, ticket: t });
    }

    return res.status(400).json({ error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
