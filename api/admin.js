// api/admin.js - Trang nội bộ: CSKH (hàng đợi MANUAL_REVIEW), Kế toán (chi hoàn + báo cáo đối soát),
// IT/Dev (giám sát API, cảnh báo, chạy Job). Yêu cầu header x-admin-key = ADMIN_KEY.
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const { fail, requireAdmin, clean } = require('../lib/api-util');

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

// Người xử lý (tự khai trên trang nội bộ cho tới khi có tài khoản nhân viên riêng)
const actorOf = (b) => clean(b.actor).slice(0, 60);

// Ghi thêm một dòng vào nhật ký vòng duyệt Nhân viên <-> Kế toán của hồ sơ
const logEntry = (rf, role, actor, act, note) =>
  [...(Array.isArray(rf.review_log) ? rf.review_log : []), { at: nowIso(), role, actor, action: act, note: note || null }];

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
  await Flow.addHistory(order, `Nhân viên (${actor}) ${resend ? 'gửi lại' : 'gửi'} hồ sơ ${rf.code} sang Kế toán chi hoàn ${vnd(rf.amount)}`);
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
  if (!requireAdmin(req, res)) return;
  const action = clean((req.query && req.query.action) || (req.body && req.body.action));
  try {
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
        ok: true, live_db: Store.isLive(), config: Flow.CONFIG, schedule: Flow.TIER1_SCHEDULE,
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
      const actor = actorOf(b);
      if (!actor) return res.status(400).json({ error: 'Nhập tên người xử lý trước khi gửi Kế toán' });
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
      const actor = actorOf(b);
      if (!actor) return res.status(400).json({ error: 'Nhập tên người xử lý trước khi trả hồ sơ' });
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
      await Flow.addHistory(order, `Kế toán (${actor}) trả hồ sơ ${rf.code} về nhân viên: ${accNote}`);
      await syncTickets(order, u, { status: 'OPEN', decision: 'ACC_RETURNED' });
      return res.status(200).json({ ok: true, refund: u });
    }

    // CSKH đối chiếu RefundForm với log cổng thanh toán (SOP 6.5.1, bước 2)
    if (action === 'decide') {
      const { rf, order } = await getRefund(b.refund_code);
      if (!['FORM_SUBMITTED', 'MANUAL_REVIEW', 'ACC_RETURNED'].includes(rf.status)) return res.status(409).json({ error: 'Hồ sơ không ở bước chờ CSKH đối chiếu' });
      const note = clean(b.note).slice(0, 500);
      if (b.decision === 'CAN_HOAN_TIEN') {
        const actor = actorOf(b);
        if (!actor) return res.status(400).json({ error: 'Nhập tên người xử lý trước khi gửi Kế toán' });
        const u = await sendToAccounting(rf, order, note, actor);
        return res.status(200).json({ ok: true, refund: u });
      }
      if (b.decision === 'NGOAI_LE') {
        const [u] = await Store.update('refunds', { id: rf.id }, {
          status: 'MANUAL_REVIEW', cs_decision: 'NGOAI_LE', cs_note: note || 'Thông tin chưa đầy đủ hoặc ảnh biên lai không rõ',
          review_log: logEntry(rf, 'NHÂN VIÊN', actorOf(b) || 'CSKH', 'Yêu cầu khách bổ sung', note)
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
      const actor = actorOf(b);
      if (!actor) return res.status(400).json({ error: 'Nhập tên người xử lý trước khi xác nhận chi' });
      const [u] = await Store.update('refunds', { id: rf.id, status: 'CS_APPROVED' }, {
        status: 'PAID_OUT', refund_ref: ref, approved_at: nowIso(), accounting_paid_at: nowIso(),
        review_log: logEntry(rf, 'KẾ TOÁN', actor, 'Đạt – đã chi', 'Mã GD ' + ref)
      });
      if (!u) return res.status(409).json({ error: 'Hồ sơ chưa được CSKH duyệt (CAN_HOAN_TIEN) hoặc đã chi' });
      await Flow.addHistory(order, `Kế toán (${actor}) đã chi hoàn thủ công ${vnd(rf.amount)} (mã GD ${ref}) – chờ CSKH xác nhận hoàn tất`);
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
