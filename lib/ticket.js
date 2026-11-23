// lib/ticket.js - Mã vé ký số và soát vé tại quầy (chống dùng vé hai lần)
//   Mã vạch (Đợt 11, đang dùng): "BC<10 số mã đơn><8 số chữ ký>" – Code 128 ngắn, dễ quét trên màn hình điện thoại.
//   Mã QR cũ (vé đã lưu trước đây vẫn nhận): "BETA1.<mã đơn>.<chữ ký 16 ký tự>".
//   Chữ ký HMAC bằng AUTH_SECRET – không giả được nếu không có khóa.
const crypto = require('crypto');
const Store = require('./store');
const Auth = require('./auth');

const httpError = (msg, http, extra = {}) => Object.assign(new Error(msg), { http }, extra);
const CHECKIN_OPEN_MS = 2 * 60 * 60 * 1000;   // mở soát vé từ 2 giờ trước giờ chiếu
const CHECKIN_CLOSE_MS = 3 * 60 * 60 * 1000;  // đóng 3 giờ sau giờ chiếu
const FNB_VALID_MS = 30 * 24 * 3600e3; // phiếu bắp nước dùng trong 30 ngày

function mac(code) {
  const key = Auth.secret();
  if (!key) throw httpError('Chưa cấu hình AUTH_SECRET trên máy chủ', 503);
  return crypto.createHmac('sha256', key).update('ticket:' + code).digest('base64url').slice(0, 16);
}

const sign = (code) => `BETA1.${code}.${mac(code)}`;

// Chữ ký 8 chữ số cho mã vạch (khóa riêng 'ticketbar:' để không suy ra được chữ ký QR)
function macDigits(code) {
  const key = Auth.secret();
  if (!key) throw httpError('Chưa cấu hình AUTH_SECRET trên máy chủ', 503);
  const h = crypto.createHmac('sha256', key).update('ticketbar:' + code).digest();
  return String(h.readUInt32BE(0) % 100000000).padStart(8, '0');
}
const barcode = (code) => code + macDigits(code);

// Đọc nội dung quét được: QR ký số, hoặc mã đơn gõ tay (không có chữ ký)
function parse(raw) {
  const s = String(raw || '').trim();
  const m = /^BETA1\.(BC\d{10})\.([A-Za-z0-9_-]{16})$/.exec(s);
  if (m) {
    const want = Buffer.from(mac(m[1]));
    const got = Buffer.from(m[2]);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw httpError('Mã QR không hợp lệ (chữ ký sai) – vé có thể bị làm giả', 400);
    return { code: m[1], signed: true };
  }
  const code = s.toUpperCase().replace(/\s+/g, '');
  // Mã vạch: BC + 10 số mã đơn + 8 số chữ ký
  const b = /^(BC\d{10})(\d{8})$/.exec(code);
  if (b) {
    const want = Buffer.from(macDigits(b[1]));
    const got = Buffer.from(b[2]);
    if (!crypto.timingSafeEqual(got, want)) throw httpError('Mã vạch không hợp lệ (chữ ký sai) – vé có thể bị làm giả', 400);
    return { code: b[1], signed: true };
  }
  if (/^BC\d{10}$/.test(code)) return { code, signed: false };
  throw httpError('Không đọc được mã vé. Quét mã vạch trên vé hoặc nhập mã đơn BC...', 400);
}

async function lastCheckin(orderId) {
  return Store.one('ticket_checkins', { order_id: orderId });
}

// Soát vé: kiểm tra chữ ký, trạng thái đơn, đúng rạp của quầy, khung giờ, và chưa soát lần nào
//   opts.cinema_id: rạp quầy đang làm việc -> vé của rạp khác bị chặn TRƯỚC khi ghi nhận (không "đốt" vé)
//   opts.force    : nhân viên xác nhận vẫn cho vào dù khác rạp (ghi vào nhật ký thao tác)
async function checkin(raw, staff, now = new Date(), opts = {}) {
  const { code, signed } = parse(raw);
  const order = await Store.one('orders', { code });
  if (!order) throw httpError('Không tìm thấy đơn ' + code, 404);
  const mv = await Store.one('movies', { id: order.movie_key || '' });
  const summary = {
    code: order.code, movie_key: order.movie_key, movie_title: mv ? mv.title : order.movie_key, cinema: order.cinema, show_date: order.show_date, show_time: order.show_time,
    show_at: order.show_at, seats: order.seats || [], customer_name: order.customer_name, signed,
    ticket_types: order.ticket_types || {},
    kind: order.kind || 'TICKET',
    // Đơn bắp nước: danh sách món để quầy giao
    items: Object.entries(order.combos || {}).filter(([, q]) => q > 0).map(([k, q]) => ({ key: k, name: ((require('../catalog').COMBOS[k]) || {}).name || k, qty: q }))
  };
  // Phòng chiếu + rạp của suất (để quầy chỉ đường và so với rạp đang làm việc).
  // Chỉ tra bảng suất chiếu khi khóa là uuid: phiếu bắp nước có khóa "FNB:<mã rạp>" (database thật báo lỗi khi so cột uuid với chuỗi khác).
  const sk = String(order.showtime_key || '');
  const st = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sk) ? await Store.one('showtimes', { id: sk }) : null;
  summary.room = st ? (st.room || null) : null;
  summary.cinema_id = st ? st.cinema_id : (sk.startsWith('FNB:') ? sk.slice(4) : null);
  // Vé ưu đãi (HSSV, trẻ em, người cao tuổi…): nhắc quầy kiểm tra giấy tờ theo từng ghế
  const types = (await require('./catalog-db').pricing()).types;
  summary.special = Object.entries(summary.ticket_types)
    .filter(([, code]) => code && code !== 'ADULT' && code !== 'COUPLE')
    .map(([seat, code]) => ({ seat, code, label: (types[code] || {}).label || code, note: (types[code] || {}).note || '' }));
  if (!['CONFIRMED', 'CONFIRMED_LATE'].includes(order.status)) throw httpError('Đơn chưa xuất vé (trạng thái: ' + order.status + ')', 409, { summary });
  // Vé / phiếu của rạp khác với rạp quầy đang chọn
  if (opts.cinema_id) {
    const here = await Store.one('cinemas', { id: String(opts.cinema_id) });
    const other = summary.cinema_id ? summary.cinema_id !== String(opts.cinema_id) : !!(here && order.cinema && order.cinema !== here.name);
    if (here && other) {
      if (!opts.force) throw httpError(`VÉ CỦA RẠP KHÁC: ${order.cinema || '?'} – quầy đang chọn ${here.name}`, 409, { summary, wrong_cinema: true });
      summary.forced_other = true; // thật sự là vé rạp khác và nhân viên đã xác nhận cho vào -> ghi nhật ký ngoại lệ
    }
  }
  // Phiếu bắp nước: dùng một lần, trong 30 ngày kể từ khi thanh toán
  if (order.kind === 'FNB') {
    const paidAt = new Date(order.confirmed_at || order.paid_at || order.created_at).getTime();
    if (now.getTime() > paidAt + FNB_VALID_MS) throw httpError('Phiếu bắp nước đã quá hạn 30 ngày', 409, { summary });
  }
  if (order.show_at) {
    const t = new Date(order.show_at).getTime();
    if (now.getTime() < t - CHECKIN_OPEN_MS) throw httpError('Chưa đến giờ soát vé (mở trước giờ chiếu 2 tiếng)', 409, { summary });
    if (now.getTime() > t + CHECKIN_CLOSE_MS) throw httpError('Suất chiếu đã kết thúc – vé hết hiệu lực', 409, { summary });
  }
  const prev = await lastCheckin(order.id);
  if (prev) throw httpError(`VÉ ĐÃ ĐƯỢC SOÁT lúc ${new Date(prev.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} bởi ${prev.staff_name}`, 409, { summary, already: true });
  try {
    await Store.insert('ticket_checkins', { order_id: order.id, order_code: order.code, staff_id: staff ? staff.id : null, staff_name: staff ? staff.full_name : null, method: signed ? 'QR' : 'CODE' });
  } catch (e) {
    if (e.code === '23505') throw httpError('VÉ ĐÃ ĐƯỢC SOÁT (vừa có quầy khác quét)', 409, { summary, already: true });
    throw e;
  }
  return summary;
}

module.exports = { sign, barcode, parse, checkin, lastCheckin };
