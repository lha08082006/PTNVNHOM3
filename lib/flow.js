// lib/flow.js - Bộ máy quy trình "Cứu vé trước – Hoàn tiền sau" (3 tầng)
//
// Tầng 1 (trong 10 phút giữ ghế): chờ Webhook 2 phút -> Short Polling 15 giây/lần (4 lần)
//         -> Final Check 3 phút/lần -> lần tra cứu chốt khi hết 10 phút.
// Tầng 2 (sau khi hết giờ giữ ghế, cửa sổ 24 giờ): Job 30 phút/lần quét đơn EXPIRED,
//         kiểm tra chéo BR-01, cấp vé bù (BR-03) hoặc chuyển hoàn tiền.
// Tầng 3: hoàn tiền tự động có idempotencyKey (BR-04), gửi lại mỗi chu kỳ Job trong hạn 24 giờ
//         (BR-05); quá hạn -> MANUAL_REVIEW + RefundForm + SupportTicket (BR-06).
//
// Mọi hàm đều idempotent: gọi lại nhiều lần (webhook trùng, nhiều tab cùng hỏi trạng thái,
// cron chạy chồng) không tạo vé trùng hay lệnh hoàn trùng. Đổi trạng thái đơn dùng
// "compare-and-set" (chỉ cập nhật khi trạng thái vẫn là trạng thái cũ).
const Store = require('./store');
const Gateway = require('./gateway');
const Catalog = require('../catalog');
const Mailer = require('./mailer');
const CatalogDB = require('./catalog-db');
const Ticket = require('./ticket');
const Points = require('./points');

const MIN = 60 * 1000;
const CONFIG = {
  HOLD_MS: 10 * MIN,
  WEBHOOK_WAIT_MS: 2 * MIN,
  SHORT_POLL_MS: 15 * 1000,
  SHORT_POLL_COUNT: 4,
  FINAL_CHECK_MS: 3 * MIN,
  JOB_MS: 30 * MIN,
  SCAN_WINDOW_MS: 24 * 60 * MIN,
  REFUND_DEADLINE_MS: 24 * 60 * MIN,
  MIN_BEFORE_SHOW_MS: 30 * MIN,
  ALERT_CONSECUTIVE_ERRORS: 3
};

// Lịch tra cứu Tầng 1 tính từ lúc tạo đơn: 2:00, 2:15, 2:30, 2:45 (Short Polling)
// rồi 5:45, 8:45 (Final Check 3 phút/lần). Lần chốt lúc 10:00 do expireTier1 thực hiện.
const TIER1_SCHEDULE = (() => {
  const s = [];
  for (let n = 0; n < CONFIG.SHORT_POLL_COUNT; n++) {
    s.push({ at: CONFIG.WEBHOOK_WAIT_MS + n * CONFIG.SHORT_POLL_MS, phase: 'SHORT_POLL', n: n + 1 });
  }
  let t = s[s.length - 1].at + CONFIG.FINAL_CHECK_MS;
  let k = 1;
  while (t < CONFIG.HOLD_MS) { s.push({ at: t, phase: 'FINAL_CHECK', n: k++ }); t += CONFIG.FINAL_CHECK_MS; }
  return s;
})();

const STATUS_LABEL = {
  PENDING: 'Đang chờ thanh toán',
  CONFIRMED: 'Đã xuất vé',
  CONFIRMED_LATE: 'Đã cấp vé bù',
  EXPIRED: 'Đang chờ đối soát tiền',
  REFUND_REQUESTED: 'Đang hoàn tiền',
  REFUNDED: 'Đã hoàn tiền',
  MANUAL_REVIEW: 'Chờ xử lý thủ công',
  CANCELLED: 'Đã hủy',
  FAILED: 'Thanh toán thất bại'
};

const REFUND_REASON_LABEL = {
  LATE: 'Tiền về sau khi hết 10 phút giữ ghế',
  SEAT_TAKEN: 'Ghế đã được bán cho khách khác',
  NEAR_SHOWTIME: 'Còn dưới 30 phút trước giờ chiếu',
  SHORT: 'Chuyển thiếu tiền và hết thời gian giữ ghế',
  EXCESS: 'Hoàn phần tiền chuyển thừa',
  DUPLICATE: 'Thanh toán trùng cho đơn đã xuất vé',
  MISMATCH: 'Dữ liệu giao dịch không khớp (cần CSKH kiểm tra)'
};

const iso = (d) => new Date(d).toISOString();
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------
function parseShowAt(showDate, showTime, now = new Date()) {
  const tm = String(showTime || '').match(/(\d{1,2}):(\d{2})/);
  if (!tm) return null;
  const vnNow = new Date(now.getTime() + 7 * 60 * MIN);
  let d, m, y;
  const dm = String(showDate || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (dm) { d = +dm[1]; m = +dm[2]; y = dm[3] ? +dm[3] : vnNow.getUTCFullYear(); }
  else if (/hôm nay|today/i.test(showDate || '') || !showDate) { d = vnNow.getUTCDate(); m = vnNow.getUTCMonth() + 1; y = vnNow.getUTCFullYear(); }
  else return null;
  let t = Date.UTC(y, m - 1, d, +tm[1] - 7, +tm[2]);
  if (!dm || !dm[3]) { if (t < now.getTime() - 60 * 24 * 60 * MIN) t = Date.UTC(y + 1, m - 1, d, +tm[1] - 7, +tm[2]); }
  return new Date(t).toISOString();
}

function genCode(prefix, digits) {
  let s = '';
  for (let i = 0; i < digits; i++) s += Math.floor(Math.random() * 10);
  return prefix + (s[0] === '0' ? '1' + s.slice(1) : s);
}

async function log(orderCode, api, phase, result, detail = {}) {
  try {
    await Store.insert('gateway_logs', { order_code: orderCode, api, phase, result, detail });
  } catch (e) { console.warn('[log]', e.message); }
}

// Gửi thông báo đa kênh (BR-09). EMAIL gửi thật qua Resend khi đã cấu hình (lib/mailer.js);
// SMS chưa tích hợp nhà mạng (chỉ ghi nhật ký). Mọi kênh đều ghi lại nội dung để đối chiếu.
async function notify(order, event, title, message, channels = ['WEB', 'EMAIL', 'SMS']) {
  for (const channel of channels) {
    let recipient = channel === 'EMAIL' ? (order.email || 'chưa có email') : channel === 'SMS' ? (order.phone || 'chưa có SĐT') : 'website';
    if (channel === 'EMAIL' && order.email) {
      const r = await Mailer.send({ to: order.email, title, message, orderCode: order.code });
      if (r.sent) recipient += ' (đã gửi)';
      else if (r.reason !== 'not-configured') { recipient += ' (lỗi gửi: ' + String(r.reason).slice(0, 80) + ')'; console.warn('[mail]', order.code, r.reason); }
    }
    // Chưa tích hợp nhà mạng SMS: chỉ ghi nhật ký, không gửi
    if (channel === 'SMS') recipient += ' (chưa gửi – chưa tích hợp SMS)';
    try {
      await Store.insert('notifications', { order_code: order.code, channel, event, title, message, recipient });
    } catch (e) { console.warn('[notify]', e.message); }
  }
}

// Đổi trạng thái có điều kiện (compare-and-set) + ghi lịch sử. Trả về đơn mới hoặc null nếu bị luồng khác đổi trước.
async function transition(order, toStatus, patch = {}, note = '') {
  const history = Array.isArray(order.history) ? order.history.slice() : [];
  history.push({ at: iso(Date.now()), from: order.status, to: toStatus, note });
  const rows = await Store.update('orders', { id: order.id, status: order.status }, { ...patch, status: toStatus, history });
  if (!rows.length) return null;
  // Beta Club: xuất vé -> cộng điểm; đơn không thành -> trả lại điểm đã dùng (idempotent)
  await Points.onStatus(rows[0]);
  // Hệ thống đã tự xử lý xong (xuất vé / cấp vé bù / hoàn tiền) -> đóng các phiếu "khách báo lỗi" còn mở
  if (['CONFIRMED', 'CONFIRMED_LATE', 'REFUNDED'].includes(toStatus)) {
    await Store.update('support_tickets', { order_code: order.code, type: 'PAYMENT_REPORT', status: { neq: 'RESOLVED' } },
      { status: 'RESOLVED', decision: 'AUTO', note: `Hệ thống tự xử lý: ${STATUS_LABEL[toStatus]}`, updated_at: iso(Date.now()) });
  }
  return rows[0];
}

async function addHistory(order, note) {
  const history = Array.isArray(order.history) ? order.history.slice() : [];
  history.push({ at: iso(Date.now()), from: order.status, to: order.status, note });
  const rows = await Store.update('orders', { id: order.id }, { history });
  return rows[0] || order;
}

// ---------------------------------------------------------------------------
// Ghế: giữ, bán, nhả, khóa nguyên tử
// ---------------------------------------------------------------------------
async function clearStaleHolds(showtimeKey, seats, now = new Date()) {
  await Store.remove('seat_holds', { showtime_key: showtimeKey, seat_id: { in: seats }, status: 'HELD', expires_at: { lt: iso(now) } });
}

async function claimSeats(order, status, expiresAt) {
  const seats = order.seats || [];
  await clearStaleHolds(order.showtime_key, seats);
  const done = [];
  for (const seat of seats) {
    try {
      await Store.insert('seat_holds', { showtime_key: order.showtime_key, seat_id: seat, order_id: order.id, status, expires_at: expiresAt });
      done.push(seat);
    } catch (e) {
      if (e.code !== '23505') throw e;
      const holder = await Store.one('seat_holds', { showtime_key: order.showtime_key, seat_id: seat });
      if (holder && holder.order_id === order.id) { done.push(seat); continue; }
      for (const s of done) await Store.remove('seat_holds', { showtime_key: order.showtime_key, seat_id: s, order_id: order.id });
      return { ok: false, taken: seat };
    }
  }
  return { ok: true };
}

const sellSeats = (order) => Store.update('seat_holds', { order_id: order.id }, { status: 'SOLD', expires_at: null });
const releaseSeats = (order) => Store.remove('seat_holds', { order_id: order.id, status: 'HELD' });

async function takenSeats(showtimeKey, now = new Date()) {
  const rows = await Store.find('seat_holds', { showtime_key: showtimeKey }, { order: null });
  return rows.filter(r => r.status === 'SOLD' || (r.expires_at && new Date(r.expires_at) > now))
    .map(r => ({ seat: r.seat_id, status: r.status }));
}

// ---------------------------------------------------------------------------
// Tạo đơn (PENDING + khóa ghế 10 phút)
// ---------------------------------------------------------------------------
async function createOrder(input, now = new Date()) {
  // Giá luôn do máy chủ tính (giá ghế theo suất chiếu + combo + voucher đã kiểm tra trong DB);
  // số tiền trình duyệt gửi lên chỉ dùng để đối chiếu
  const fnb = input.kind === 'FNB';
  if (!fnb && !input.trusted_movie && !Catalog.getMovie(input.movie_key)) throw Object.assign(new Error('Phim không tồn tại: ' + (input.movie_key || '')), { http: 400 });
  const q = Catalog.quote({
    seats: input.seats, combos: input.combos, voucher: input.voucher, prices: input.prices,
    ticket_types: input.ticket_types || {}, types: input.types || undefined, show_dow: input.show_dow != null ? input.show_dow : null,
    points: input.points || 0, fnb, layout: input.layout || null,
    vouchers: input.voucher_def ? { [input.voucher_def.code]: input.voucher_def } : undefined
  });
  const seats = q.seats.map(s => s.id);
  const total = q.total;
  if (!(total > 0)) throw Object.assign(new Error('Số tiền đơn hàng không hợp lệ'), { http: 400 });
  if (input.total != null && Math.round(Number(input.total)) !== total) {
    throw Object.assign(new Error(`Giá đơn hàng đã được cập nhật thành ${vnd(total)}. Vui lòng kiểm tra lại trước khi thanh toán.`), { http: 409, quote: q });
  }

  const showtimeKey = input.showtime_key || [input.movie_key, input.cinema, input.show_date, input.show_time].join('|');
  const holdExpires = new Date(now.getTime() + CONFIG.HOLD_MS);
  let order;
  for (let i = 0; i < 3 && !order; i++) {
    try {
      order = await Store.insert('orders', {
        code: input.code || genCode('BC', 10),
        user_id: input.user_id || null,
        phone: input.phone || null,
        email: input.email || null,
        customer_name: input.customer_name || null,
        movie_key: input.movie_key || '',
        cinema: input.cinema || '',
        show_date: input.show_date || '',
        show_time: input.show_time || '',
        show_at: input.show_at || parseShowAt(input.show_date, input.show_time, now),
        showtime_key: showtimeKey,
        seats,
        combos: Object.fromEntries(q.combos.map(c => [c.key, c.qty])),
        // Loại vé theo từng ghế (Người lớn / HSSV / Trẻ em / Người cao tuổi / Ghế đôi) – quầy soát vé đối chiếu giấy tờ
        ticket_types: Object.fromEntries(q.seats.map(s => [s.id, s.ticket_type])),
        // Giá thực trả từng ghế (đã gồm giá theo khung giờ và giảm theo loại vé) – hóa đơn dùng đúng số này
        seat_prices: Object.fromEntries(q.seats.map(s => [s.id, s.price])),
        voucher: q.voucher,
        kind: fnb ? 'FNB' : 'TICKET',
        points_used: q.points_used,
        total,
        paid_amount: 0,
        status: 'PENDING',
        hold_expires_at: iso(holdExpires),
        check_seq: 0,
        sandbox: input.sandbox || null,
        history: [{ at: iso(now), from: null, to: 'PENDING', note: fnb ? 'Tạo đơn bắp nước, hiển thị VietQR (thanh toán trong 10 phút)' : 'Tạo đơn, khóa ghế 10 phút, hiển thị VietQR' }],
        created_at: iso(now)
      });
    } catch (e) {
      if (e.code !== '23505' || input.code) throw e;
    }
  }

  const seatRes = await claimSeats(order, 'HELD', iso(holdExpires));
  if (!seatRes.ok) {
    await Store.remove('orders', { id: order.id });
    throw Object.assign(new Error(`Ghế ${seatRes.taken} vừa có người khác giữ hoặc đã bán. Vui lòng chọn ghế khác.`), { http: 409, taken: seatRes.taken });
  }
  if (q.points_used > 0) {
    try {
      await Points.redeem(order.user_id, order.code, q.points_used, now);
    } catch (e) {
      await Store.remove('seat_holds', { order_id: order.id });
      await Store.remove('orders', { id: order.id });
      throw e;
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// Hoàn tiền (Tầng 3)
// ---------------------------------------------------------------------------
function sourceAccountOf(txs) {
  for (const t of txs || []) {
    const s = (t.raw && t.raw.sender) || null;
    if (s && s.acc_number) return s;
  }
  return null;
}

async function createRefund(order, { amount, reason, txs, status = 'REQUESTED', key }, now = new Date()) {
  const txRef = (txs || []).map(t => t.reference_code).join('+') || 'NO_TX';
  const idempotencyKey = key || `${order.code}:${reason}:${txRef}`;
  const existing = await Store.one('refunds', { idempotency_key: idempotencyKey });
  if (existing) return existing;
  try {
    return await Store.insert('refunds', {
      code: genCode('REF-', 8),
      order_id: order.id,
      order_code: order.code,
      amount,
      reason,
      status,
      idempotency_key: idempotencyKey,
      tx_refs: txRef,
      source_account: sourceAccountOf(txs),
      attempts: 0,
      is_manual: status === 'MANUAL_REVIEW',
      deadline_at: iso(now.getTime() + CONFIG.REFUND_DEADLINE_MS),
      created_at: iso(now)
    });
  } catch (e) {
    if (e.code === '23505') return Store.one('refunds', { idempotency_key: idempotencyKey });
    throw e;
  }
}

async function openTicket(order, { type, priority = 'HIGH', summary, refund = null }) {
  const open = await Store.find('support_tickets', { order_code: order.code, type, status: { neq: 'RESOLVED' } }, { limit: 1 });
  const context = await buildContext(order, refund);
  if (open[0]) {
    const rows = await Store.update('support_tickets', { id: open[0].id }, { context, updated_at: iso(Date.now()) });
    return rows[0];
  }
  return Store.insert('support_tickets', {
    code: genCode('CS-', 6),
    order_code: order.code,
    refund_code: refund ? refund.code : null,
    type, priority, status: 'OPEN', summary, context,
    updated_at: iso(Date.now())
  });
}

// BR-11: gom sẵn ngữ cảnh để CSKH không phải hỏi lại khách
async function buildContext(order, refund) {
  const txs = await Store.find('bank_transactions', { code: order.code }, { order: 'transaction_date', asc: true });
  const logs = await Store.find('gateway_logs', { order_code: order.code }, { limit: 20 });
  const rf = refund || (await Store.find('refunds', { order_code: order.code }, { limit: 1 }))[0] || null;
  return {
    order: {
      code: order.code, status: order.status, total: order.total, paid_amount: order.paid_amount,
      phone: order.phone, email: order.email, customer_name: order.customer_name,
      movie_key: order.movie_key, cinema: order.cinema, show_date: order.show_date, show_time: order.show_time,
      seats: order.seats, created_at: order.created_at, hold_expires_at: order.hold_expires_at
    },
    transactions: txs.map(t => ({ reference_code: t.reference_code, amount: t.amount, transaction_date: t.transaction_date, content: t.content, gateway: t.gateway })),
    refund: rf ? {
      code: rf.code, amount: rf.amount, reason: rf.reason, status: rf.status, attempts: rf.attempts, last_error: rf.last_error,
      form: rf.form_submitted_at ? { bank_name: rf.bank_name, acc_number: rf.acc_number, acc_name: rf.acc_name, has_receipt: !!rf.receipt_url } : null
    } : null,
    gateway_logs: logs.map(l => ({ at: l.created_at, api: l.api, phase: l.phase, result: l.result }))
  };
}

async function processRefund(refund, { force = false } = {}, now = new Date()) {
  if (!['REQUESTED', 'RETRYING'].includes(refund.status)) return refund;
  if (!force && refund.last_attempt_at && now - new Date(refund.last_attempt_at) < CONFIG.JOB_MS) return refund;

  const order = await Store.one('orders', { id: refund.order_id });
  if (!order) return refund;

  // Quá hạn tự hoàn 24 giờ -> chuyển xử lý thủ công (BR-06)
  if (now >= new Date(refund.deadline_at)) return escalateRefund(refund, order, 'Quá hạn 24 giờ tự hoàn tiền nhưng Refund API vẫn chưa thành công');

  // BR-04: kiểm tra chéo lại trước khi gửi lệnh
  const txs = await Store.find('bank_transactions', { code: order.code, transfer_type: 'in' });
  const received = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const refundedBefore = (await Store.find('refunds', { order_code: order.code, status: 'DONE' }))
    .filter(r => r.id !== refund.id).reduce((s, r) => s + Number(r.amount || 0), 0);
  if (refund.amount > received - refundedBefore) {
    await log(order.code, 'REFUND', 'CROSS_CHECK', 'REJECTED', { amount: refund.amount, received, refundedBefore });
    return escalateRefund(refund, order, 'Số tiền hoàn vượt số tiền thực nhận - cần kiểm tra thủ công');
  }
  if (!refund.verified_at) {
    const rows = await Store.update('refunds', { id: refund.id }, { verified_at: iso(now) });
    refund = rows[0] || refund;
  }

  const source = refund.source_account || sourceAccountOf(txs);
  const res = await Gateway.refund({ refund, order, source });
  const attempts = Number(refund.attempts || 0) + 1;
  await log(order.code, 'REFUND', attempts === 1 ? 'REFUND' : 'RETRY', res.ok ? 'SUCCESS' : 'ERROR', { attempt: attempts, error: res.error, ref: res.ref, key: refund.idempotency_key });

  if (!res.ok) {
    const rows = await Store.update('refunds', { id: refund.id, status: refund.status }, { status: 'RETRYING', attempts, last_attempt_at: iso(now), last_error: res.error });
    return rows[0] || refund;
  }

  const rows = await Store.update('refunds', { id: refund.id, status: refund.status }, {
    status: 'DONE', attempts, last_attempt_at: iso(now), approved_at: iso(now), done_at: iso(now),
    refund_ref: res.ref, source_account: source, is_manual: false, last_error: null
  });
  const done = rows[0];
  if (!done) return refund;

  if (order.status === 'REFUND_REQUESTED') {
    await transition(order, 'REFUNDED', {}, `Đã gửi lệnh hoàn ${vnd(done.amount)} về tài khoản nguồn (mã ${res.ref})`);
  } else {
    await addHistory(order, `Đã hoàn ${vnd(done.amount)} (${REFUND_REASON_LABEL[done.reason] || done.reason})`);
  }
  await notify(order, 'REFUNDED', 'Đã gửi lệnh hoàn tiền',
    `Beta Cinemas đã gửi lệnh hoàn ${vnd(done.amount)} cho đơn ${order.code} về tài khoản ${source.bank_name || ''} ${maskAcc(source.acc_number)}. Thời gian tiền về tùy ngân hàng (thường 3–7 ngày làm việc).`);
  return done;
}

const maskAcc = (a) => (a ? String(a).replace(/.(?=.{4})/g, '•') : '');

async function escalateRefund(refund, order, why) {
  const rows = await Store.update('refunds', { id: refund.id }, { status: 'MANUAL_REVIEW', is_manual: true, last_error: why });
  const rf = rows[0] || refund;
  let ord = order;
  if (['REFUND_REQUESTED', 'EXPIRED', 'CANCELLED'].includes(order.status)) {
    ord = (await transition(order, 'MANUAL_REVIEW', { manual_reason: why }, why)) || order;
  } else {
    ord = await addHistory(order, why);
  }
  await openTicket(ord, { type: 'MANUAL_REVIEW', summary: why, refund: rf });
  await notify(ord, 'REFUND_FORM', 'Cần bổ sung thông tin nhận hoàn tiền',
    `Hệ thống chưa thể tự hoàn ${vnd(rf.amount)} cho đơn ${ord.code}. Vui lòng điền biểu mẫu thông tin ngân hàng và ảnh biên lai để CSKH hoàn tiền thủ công (3–7 ngày làm việc).`);
  return rf;
}

// ---------------------------------------------------------------------------
// Đánh giá thanh toán
// ---------------------------------------------------------------------------
async function queryGateway(order, phase, now) {
  try {
    const g = await Gateway.queryStatus(order, now);
    await log(order.code, 'QUERY_STATUS', phase, g.status, { amount: g.amount, txs: g.txs.map(t => t.reference_code) });
    return g;
  } catch (e) {
    await log(order.code, 'QUERY_STATUS', phase, 'ERROR', { error: e.message });
    return null;
  }
}

// Tầng 1: tiền về trong lúc ghế còn giữ cho chính đơn này (BR-01a + BR-02)
async function settleWithinHold(order, g, phaseNote) {
  const amount = g.amount;
  if (amount === order.total || amount > order.total) {
    const confirmed = await transition(order, 'CONFIRMED', {
      paid_amount: amount, paid_at: g.firstTxAt, confirmed_at: iso(Date.now()),
      source_account: sourceAccountOf(g.txs)
    }, `${phaseNote}: cổng báo SUCCESS ${vnd(amount)}, khớp mã đơn – xuất vé`);
    if (!confirmed) return null;
    await sellSeats(confirmed);
    await notify(confirmed, 'CONFIRMED', 'Đặt vé thành công',
      confirmed.kind === 'FNB'
        ? `Đơn bắp nước ${confirmed.code} đã thanh toán. Xuất trình mã QR tại quầy ${confirmed.cinema} để nhận món (dùng trong 30 ngày).`
        : `Vé điện tử cho đơn ${confirmed.code} (ghế ${confirmed.seats.join(', ')}) đã được xuất. Xuất trình mã vé tại quầy để vào rạp.`);
    if (amount > order.total) {
      const rf = await createRefund(confirmed, { amount: amount - order.total, reason: 'EXCESS', txs: g.txs });
      await processRefund(rf, { force: true });
    }
    return confirmed;
  }
  if (amount > 0 && amount !== order.paid_amount) {
    const rows = await Store.update('orders', { id: order.id, status: 'PENDING' }, { paid_amount: amount });
    const o = rows[0] || order;
    await addHistory(o, `${phaseNote}: mới nhận ${vnd(amount)}/${vnd(order.total)} – chờ khách chuyển bù ${vnd(order.total - amount)}`);
    await notify(o, 'PARTIAL', 'Đã nhận một phần thanh toán',
      `Đơn ${o.code} mới nhận ${vnd(amount)}. Vui lòng chuyển thêm ${vnd(order.total - amount)} trước khi hết giờ giữ ghế.`, ['WEB']);
    return o;
  }
  return order;
}

// Tầng 1 kết thúc: hết 10 phút giữ ghế
async function expireTier1(order, now, why = 'Hết 10 phút') {
  const g = await queryGateway(order, 'EXPIRY_CHECK', now);
  if (g && g.status === 'SUCCESS' && g.amount >= order.total && new Date(g.firstTxAt) <= new Date(order.hold_expires_at)) {
    return settleWithinHold(order, g, 'Tra cứu chốt lúc hết giờ');
  }
  await releaseSeats(order);
  await Gateway.cancelOrder(order);
  await log(order.code, 'CANCEL_ORDER', 'EXPIRY_CHECK', 'OK', {});

  // Đã nhận một phần nhưng không đủ -> hoàn phần đã nhận
  if (g && g.status === 'SUCCESS' && g.amount > 0 && g.amount < order.total) {
    const o = await transition(order, 'REFUND_REQUESTED', { paid_amount: g.amount }, `Hết giờ giữ ghế, mới nhận ${vnd(g.amount)}/${vnd(order.total)} – hoàn lại phần đã nhận`);
    if (!o) return null;
    const rf = await createRefund(o, { amount: g.amount, reason: 'SHORT', txs: g.txs });
    await notify(o, 'REFUND_REQUESTED', 'Đơn hết hạn – đang hoàn tiền', `Đơn ${o.code} hết thời gian giữ ghế khi chưa đủ tiền. Hệ thống tự hoàn ${vnd(g.amount)} trong tối đa 24 giờ.`);
    await processRefund(rf, { force: true });
    return Store.one('orders', { id: o.id });
  }

  const lateMoney = g && g.status === 'SUCCESS' && g.amount >= order.total;
  const unclear = !g || g.status === 'PENDING' || order.reported_at || lateMoney;
  if (unclear) {
    const o = await transition(order, 'EXPIRED', {
      expired_at: iso(now), scan_until: iso(now.getTime() + CONFIG.SCAN_WINDOW_MS), job_checked_at: iso(now)
    }, `${why}, chưa rõ kết quả thanh toán – nhả ghế, hủy mã QR, đưa vào danh sách quét (ScanList) 24 giờ`);
    // Tiền về đúng lúc vừa hết giờ -> xử lý ngay theo Tầng 2 thay vì chờ chu kỳ Job
    if (o && lateMoney) return settleAfterHold(o, g, 'EXPIRY_CHECK', now);
    if (o) await notify(o, 'EXPIRED', 'Đang đối soát giao dịch',
      `Đơn ${o.code} đã hết giờ giữ ghế nhưng hệ thống vẫn đang đối soát với ngân hàng. Nếu tiền đã bị trừ, bạn sẽ được cấp vé bù hoặc hoàn tiền tự động – không cần liên hệ CSKH.`, ['WEB', 'EMAIL']);
    return o;
  }
  return transition(order, 'CANCELLED', {}, `${why}, không có giao dịch – hủy đơn, nhả ghế`);
}

// Khách tự hủy đơn đang chờ thanh toán (chưa chuyển đồng nào) để nhả ghế ngay.
// Đi đúng đường "hết giờ giữ ghế": nếu cổng chưa chắc chắn thì đơn vào ScanList 24 giờ,
// nên tiền chuyển muộn vẫn được cấp vé bù hoặc hoàn tự động.
async function cancelByCustomer(order, now = new Date()) {
  const conflict = (msg) => Object.assign(new Error(msg), { http: 409 });
  if (!order || order.status !== 'PENDING') throw conflict('Đơn không còn ở trạng thái chờ thanh toán nên không thể hủy.');
  if (Number(order.paid_amount || 0) > 0) throw conflict('Đơn đã nhận một phần tiền. Vui lòng chuyển bù hoặc chờ hết giờ giữ ghế để hệ thống tự hoàn lại.');
  const g = await queryGateway(order, 'CUSTOMER_CANCEL', now);
  if (g && g.status === 'SUCCESS' && g.amount > 0) {
    // Tiền vừa về đúng lúc khách bấm hủy: không hủy, xử lý giao dịch như bình thường
    if (g.amount >= order.total) return settleWithinHold(order, g, 'Tra cứu khi khách bấm hủy');
    throw conflict('Hệ thống vừa nhận một phần tiền cho đơn này. Vui lòng chuyển bù hoặc chờ hết giờ giữ ghế để được hoàn lại.');
  }
  order = (await addHistory(order, 'Khách chủ động hủy đơn trước khi thanh toán')) || order;
  return expireTier1(order, now, 'Khách hủy đơn');
}

// Tầng 2: tiền được xác nhận sau khi đơn đã EXPIRED/CANCELLED (BR-01b + BR-03)
async function settleAfterHold(order, g, phase, now) {
  const refunds = await Store.find('refunds', { order_code: order.code });
  // BR-01 (3): chưa xuất vé, chưa hoàn tiền; khớp số tiền và mã đơn
  if (refunds.length) return order;
  if (g.amount !== order.total) {
    await log(order.code, 'QUERY_STATUS', phase, 'MISMATCH', { amount: g.amount, total: order.total });
    const why = `Kiểm tra chéo thất bại: nhận ${vnd(g.amount)} nhưng đơn ${vnd(order.total)} – chuyển CSKH kiểm tra`;
    const o = await transition(order, 'MANUAL_REVIEW', { paid_amount: g.amount, manual_reason: why }, why);
    if (!o) return null;
    const rf = await createRefund(o, { amount: g.amount, reason: 'MISMATCH', txs: g.txs, status: 'MANUAL_REVIEW' });
    await openTicket(o, { type: 'DATA_MISMATCH', summary: why, refund: rf });
    await notify(o, 'REFUND_FORM', 'Giao dịch cần CSKH kiểm tra',
      `Số tiền nhận được cho đơn ${o.code} không khớp giá trị đơn. Vui lòng điền biểu mẫu thông tin ngân hàng và ảnh biên lai để CSKH đối chiếu và hoàn tiền.`);
    return o;
  }

  const paidInTime = new Date(g.firstTxAt) <= new Date(order.hold_expires_at);
  const showOk = !order.show_at || new Date(order.show_at) - now >= CONFIG.MIN_BEFORE_SHOW_MS;
  let reason = null;
  if (!paidInTime) reason = 'LATE';
  else if (!showOk) reason = 'NEAR_SHOWTIME';
  else {
    const lock = await claimSeats(order, 'SOLD', null); // lockAtomic()
    if (lock.ok) {
      const o = await transition(order, 'CONFIRMED_LATE', {
        paid_amount: g.amount, paid_at: g.firstTxAt, confirmed_at: iso(now), source_account: sourceAccountOf(g.txs)
      }, `${phase === 'WEBHOOK' ? 'Webhook về trễ' : 'Job đối soát'}: tiền vào trước hạn giữ ghế, ghế còn trống – khóa ghế và cấp vé bù`);
      if (!o) { await Store.remove('seat_holds', { order_id: order.id }); return null; }
      await notify(o, 'CONFIRMED_LATE', 'Đã cấp vé bù',
        `Giao dịch của đơn ${o.code} đã được đối soát thành công. Vé bù cho ghế ${o.seats.join(', ')} đã được xuất.`);
      return o;
    }
    reason = 'SEAT_TAKEN';
  }

  const o = await transition(order, 'REFUND_REQUESTED', { paid_amount: g.amount, paid_at: g.firstTxAt, source_account: sourceAccountOf(g.txs) },
    `Không thể cấp vé bù (${REFUND_REASON_LABEL[reason]}) – chuyển hoàn tiền tự động`);
  if (!o) return null;
  const rf = await createRefund(o, { amount: g.amount, reason, txs: g.txs }, now);
  await notify(o, 'REFUND_REQUESTED', 'Đang hoàn tiền tự động',
    `Đơn ${o.code}: ${REFUND_REASON_LABEL[reason]}. Hệ thống tự gửi lệnh hoàn ${vnd(g.amount)} về tài khoản đã chuyển trong tối đa 24 giờ.`);
  await processRefund(rf, { force: true }, now);
  return Store.one('orders', { id: o.id });
}

// ---------------------------------------------------------------------------
// tick(): đưa một đơn tiến tới trạng thái đúng theo thời gian hiện tại
// ---------------------------------------------------------------------------
async function tick(order, { phase = null, force = false } = {}, now = new Date()) {
  if (!order) return null;
  const st = order.status;

  if (st === 'PENDING') {
    if (now >= new Date(order.hold_expires_at)) return expireTier1(order, now);
    const elapsed = now - new Date(order.created_at);
    const due = TIER1_SCHEDULE.filter(s => s.at <= elapsed).length;
    const seq = Number(order.check_seq || 0);
    if (phase === 'WEBHOOK' || force || due > seq) {
      const step = TIER1_SCHEDULE[Math.max(0, due - 1)];
      const label = phase || (due > seq ? `${step.phase}` : 'MANUAL');
      const rows = await Store.update('orders', { id: order.id, status: 'PENDING' }, { check_seq: Math.max(seq, due), last_check_at: iso(now) });
      const o = rows[0] || order;
      const g = await queryGateway(o, label, now);
      if (g && g.status === 'SUCCESS') {
        const note = phase === 'WEBHOOK' ? 'Webhook SePay' : label === 'SHORT_POLL' ? `Short Polling lần ${step.n}` : label === 'FINAL_CHECK' ? `Final Check lần ${step.n}` : 'Tra cứu theo yêu cầu';
        return settleWithinHold(o, g, note);
      }
      return o;
    }
    return order;
  }

  if (st === 'EXPIRED' || (st === 'CANCELLED' && (phase === 'WEBHOOK' || force))) {
    const lastJob = order.job_checked_at || order.expired_at || order.hold_expires_at;
    const jobDue = now - new Date(lastJob) >= CONFIG.JOB_MS;
    const windowOver = order.scan_until && now >= new Date(order.scan_until);
    if (!(force || phase === 'WEBHOOK' || jobDue || windowOver)) return order;
    const label = phase === 'WEBHOOK' ? 'WEBHOOK' : 'JOB_30M';
    if (st === 'EXPIRED') await Store.update('orders', { id: order.id }, { job_checked_at: iso(now) });
    const g = await queryGateway(order, label, now);
    if (g && g.status === 'SUCCESS') return settleAfterHold(order, g, label, now);
    if (st === 'EXPIRED' && windowOver) {
      return transition(order, 'CANCELLED', {}, 'Hết cửa sổ đối soát 24 giờ, cổng không báo SUCCESS – đóng đơn');
    }
    return Store.one('orders', { id: order.id });
  }

  // Đơn đã xuất vé/đã hoàn mà lại có thêm tiền vào -> hoàn phần thanh toán trùng/thừa
  if (['CONFIRMED', 'CONFIRMED_LATE', 'REFUNDED'].includes(st) && phase === 'WEBHOOK') {
    const g = await queryGateway(order, 'WEBHOOK', now);
    if (g && g.status === 'SUCCESS') {
      const keep = st === 'REFUNDED' ? 0 : order.total;
      const refundedOrPlanned = (await Store.find('refunds', { order_code: order.code })).reduce((s, r) => s + Number(r.amount || 0), 0);
      const extra = g.amount - keep - refundedOrPlanned;
      if (extra > 0) {
        const lastTx = g.txs[g.txs.length - 1];
        const rf = await createRefund(order, { amount: extra, reason: st === 'REFUNDED' ? 'LATE' : 'DUPLICATE', txs: [lastTx] }, now);
        await addHistory(order, `Nhận thêm ${vnd(extra)} sau khi đơn đã ${STATUS_LABEL[st].toLowerCase()} – tự động hoàn`);
        await processRefund(rf, { force: true }, now);
      }
    }
  }

  // Các lệnh hoàn đang chờ gửi lại theo chu kỳ Job
  const pending = await Store.find('refunds', { order_code: order.code, status: { in: ['REQUESTED', 'RETRYING'] } });
  for (const rf of pending) await processRefund(rf, { force }, now);
  return Store.one('orders', { id: order.id });
}

// Job định kỳ (cron / setInterval / nút "Chạy Job ngay" ở trang nội bộ)
async function runJob({ force = false } = {}, now = new Date()) {
  const summary = { pending: 0, expired: 0, refunds: 0, changed: [] };
  const orders = await Store.find('orders', { status: { in: ['PENDING', 'EXPIRED'] } }, { limit: 500 });
  for (const o of orders) {
    const after = await tick(o, { force: force && o.status === 'EXPIRED' }, now);
    summary[o.status === 'PENDING' ? 'pending' : 'expired']++;
    if (after && after.status !== o.status) summary.changed.push(`${o.code}: ${o.status} → ${after.status}`);
  }
  const refunds = await Store.find('refunds', { status: { in: ['REQUESTED', 'RETRYING'] } }, { limit: 500 });
  for (const r of refunds) {
    const after = await processRefund(r, { force }, now);
    summary.refunds++;
    if (after && after.status !== r.status) summary.changed.push(`${r.code}: ${r.status} → ${after.status}`);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Webhook SePay
// ---------------------------------------------------------------------------
async function handleIncomingTransfer(body, now = new Date()) {
  const amount = Number(body.transferAmount || body.amount || 0);
  const type = body.transferType || body.transfer_type || 'in';
  const ref = String(body.referenceCode || body.reference_code || ('SEPAY-' + (body.id || Date.now())));
  const code = Gateway.extractOrderCode(`${body.code || ''} ${body.content || ''} ${body.description || ''}`);

  const existed = await Store.one('bank_transactions', { reference_code: ref });
  if (existed) return { duplicate: true, code: existed.code, result: 'DUPLICATE' };
  if (type !== 'in' || amount <= 0) return { ignored: true, result: 'IGNORED' };

  const order = code ? await Store.one('orders', { code }) : null;
  let tx;
  try {
    tx = await Store.insert('bank_transactions', {
      id: Number(body.id) || undefined,
      gateway: body.gateway || null,
      account_number: body.accountNumber || body.account_number || null,
      transaction_date: body.transactionDate ? new Date(String(body.transactionDate).replace(' ', 'T') + (String(body.transactionDate).includes('Z') || /[+-]\d\d:?\d\d$/.test(body.transactionDate) ? '' : '+07:00')).toISOString() : iso(now),
      content: body.content || '',
      code: order ? code : (code || null),
      transfer_type: 'in',
      amount,
      reference_code: ref,
      raw: body,
      order_id: order ? order.id : null,
      result: order ? 'MATCHED' : 'UNMATCHED',
      note: order ? 'Webhook SePay' : 'Không tìm thấy mã đơn BCxxxxxxxxxx hợp lệ trong nội dung chuyển khoản'
    });
  } catch (e) {
    if (e.code === '23505') return { duplicate: true, code, result: 'DUPLICATE' };
    throw e;
  }

  if (!order) {
    // Không tự ghép vào đơn khác (vi phạm BR-01) – đẩy CSKH xử lý
    await Store.insert('support_tickets', {
      code: genCode('CS-', 6), order_code: code, type: 'UNMATCHED_TX', priority: 'HIGH', status: 'OPEN',
      summary: `Tiền vào ${vnd(amount)} (mã GD ${ref}) không khớp đơn nào`,
      context: { transaction: { reference_code: ref, amount, content: body.content, transaction_date: tx.transaction_date } },
      updated_at: iso(now)
    });
    return { result: 'UNMATCHED', code };
  }
  const after = await tick(order, { phase: 'WEBHOOK' }, now);
  return { result: 'MATCHED', code, status: after ? after.status : order.status };
}

// ---------------------------------------------------------------------------
// Khách báo lỗi "Đã chuyển tiền nhưng chưa có vé" (BR-10, BR-11)
// ---------------------------------------------------------------------------
async function reportIssue(order, { note, bank_ref } = {}, now = new Date()) {
  if (!order.reported_at) {
    const rows = await Store.update('orders', { id: order.id }, { reported_at: iso(now) });
    order = rows[0] || order;
    order = await addHistory(order, 'Khách báo lỗi: đã chuyển tiền nhưng chưa có vé' + (bank_ref ? ` (mã GD ${bank_ref})` : ''));
  }
  const after = await tick(order, { force: true }, now);
  const ticket = await openTicket(after || order, {
    type: 'PAYMENT_REPORT', priority: 'HIGH',
    summary: `Khách báo đã chuyển tiền nhưng chưa có vé${bank_ref ? ' – mã GD ' + bank_ref : ''}${note ? ' – ' + note : ''}`
  });
  return { order: after || order, ticket };
}

// ---------------------------------------------------------------------------
// Dữ liệu hiển thị cho khách (US-03)
// ---------------------------------------------------------------------------
async function view(order, now = new Date()) {
  const refunds = await Store.find('refunds', { order_code: order.code }, { order: 'created_at', asc: true });
  // Gộp các bản ghi cùng một thông báo (gửi qua nhiều kênh) thành một dòng kèm danh sách kênh
  const notifRows = await Store.find('notifications', { order_code: order.code }, { limit: 90 });
  const notifications = [];
  for (const n of notifRows) {
    const same = notifications.find(x => x.title === n.title && x.message === n.message && Math.abs(new Date(x.created_at) - new Date(n.created_at)) < 60000);
    if (same) { if (!same.channels.includes(n.channel)) same.channels.push(n.channel); }
    else notifications.push({ ...n, channels: [n.channel] });
  }
  const tickets = await Store.find('support_tickets', { order_code: order.code }, { limit: 5 });
  const elapsed = now - new Date(order.created_at);

  let label = STATUS_LABEL[order.status] || order.status;
  let sublabel = '';
  if (order.status === 'PENDING') {
    if (order.paid_amount > 0) { label = 'Đã nhận một phần – chờ chuyển bù'; }
    else if (elapsed >= CONFIG.WEBHOOK_WAIT_MS || order.reported_at) label = 'Đang xác minh giao dịch';
    const next = TIER1_SCHEDULE.find(s => s.at > elapsed);
    sublabel = elapsed < CONFIG.WEBHOOK_WAIT_MS ? 'Đang chờ ngân hàng báo kết quả (Webhook)'
      : next && next.phase === 'SHORT_POLL' ? `Đang tra cứu nhanh với cổng thanh toán (lần ${next.n}/4, 15 giây/lần)`
      : 'Đang kiểm tra định kỳ với cổng thanh toán (3 phút/lần)';
  }
  if (order.status === 'EXPIRED') sublabel = 'Ghế đã được nhả. Hệ thống tự kiểm tra lại với ngân hàng 30 phút/lần trong 24 giờ.';

  const refundSteps = refunds.map(r => ({
    code: r.code, amount: r.amount, reason: r.reason, reason_label: REFUND_REASON_LABEL[r.reason] || r.reason,
    status: r.status, is_manual: !!r.is_manual, attempts: r.attempts || 0, refund_ref: r.refund_ref,
    tx_refs: r.tx_refs && r.tx_refs !== 'NO_TX' ? r.tx_refs : null,
    created_at: r.created_at, deadline_at: r.deadline_at, done_at: r.done_at,
    needs_form: r.status === 'MANUAL_REVIEW',
    cs_note: r.cs_note || null,
    form_submitted: !!r.form_submitted_at,
    source_account: r.source_account ? { bank_name: r.source_account.bank_name, acc_masked: maskAcc(r.source_account.acc_number) } : null,
    // Thanh tiến trình 4 mốc (BR-08): Đã tiếp nhận -> Đối soát -> Đã duyệt -> Đã chuyển hoàn
    steps: [
      { key: 'RECEIVED', label: 'Đã tiếp nhận', at: r.created_at, done: true },
      { key: 'RECONCILED', label: 'Đối soát', at: r.verified_at || r.reconciled_at || null, done: !!(r.verified_at || r.reconciled_at) },
      { key: 'APPROVED', label: 'Đã duyệt', at: r.approved_at || null, done: !!r.approved_at },
      { key: 'DONE', label: 'Đã chuyển hoàn', at: r.done_at || null, done: r.status === 'DONE' }
    ]
  }));

  return {
    ok: true,
    id: order.id,
    code: order.code,
    status: order.status,
    status_label: label,
    status_sublabel: sublabel,
    total: order.total,
    paid_amount: order.paid_amount || 0,
    remaining_amount: Math.max(0, order.total - (order.paid_amount || 0)),
    excess_amount: Math.max(0, (order.paid_amount || 0) - order.total),
    hold_expires_at: order.hold_expires_at,
    seconds_left: order.status === 'PENDING' ? Math.max(0, Math.round((new Date(order.hold_expires_at) - now) / 1000)) : 0,
    seconds_since_created: Math.round(elapsed / 1000),
    check_seq: order.check_seq || 0,
    reported: !!order.reported_at,
    paid_at: order.paid_at,
    confirmed_at: order.confirmed_at,
    expired_at: order.expired_at,
    scan_until: order.scan_until,
    movie_key: order.movie_key,
    movie: CatalogDB.publicMovie(await Store.one('movies', { id: order.movie_key || '' })) || null,
    showtime_id: /^[0-9a-f-]{36}$/i.test(order.showtime_key || '') ? order.showtime_key : null,
    cinema: order.cinema,
    show_date: order.show_date,
    show_time: order.show_time,
    show_at: order.show_at,
    seats: order.seats || [],
    combos: order.combos || {},
    ticket_types: order.ticket_types || {},
    seat_prices: order.seat_prices || {},
    phone: order.phone,
    email: order.email,
    customer_name: order.customer_name || null,
    voucher: order.voucher || null,
    kind: order.kind || 'TICKET',
    points_used: Number(order.points_used) || 0,
    points_earned: order.user_id ? Number(((await Store.one('point_ledger', { ref: 'EARN:' + order.code })) || {}).points) || 0 : 0,
    created_at: order.created_at,
    history: order.history || [],
    has_ticket: ['CONFIRMED', 'CONFIRMED_LATE'].includes(order.status),
    ticket_qr: ['CONFIRMED', 'CONFIRMED_LATE'].includes(order.status) ? Ticket.sign(order.code) : null,
    checked_in_at: ((await Ticket.lastCheckin(order.id)) || {}).created_at || null,
    refunds: refundSteps,
    refund: refundSteps[refundSteps.length - 1] || null,
    tickets: tickets.map(t => ({ code: t.code, type: t.type, status: t.status, created_at: t.created_at })),
    notifications: notifications.slice(0, 30).map(n => ({ title: n.title, message: n.message, event: n.event, at: n.created_at, channels: n.channels }))
  };
}

module.exports = {
  CONFIG, TIER1_SCHEDULE, STATUS_LABEL, REFUND_REASON_LABEL,
  parseShowAt, createOrder, tick, runJob, handleIncomingTransfer, reportIssue, view, cancelByCustomer,
  processRefund, createRefund, openTicket, buildContext, notify, transition, addHistory, log,
  takenSeats, releaseSeats, sellSeats, genCode, maskAcc
};
