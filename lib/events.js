// lib/events.js - Yêu cầu thuê rạp / vé nhóm / Private Show / sự kiện (Đợt 3)
// Khách gửi form ở thue-rap.html -> CSKH báo giá trong admin -> khách xác nhận qua điện thoại/email -> chốt.
// Mỗi lần đổi trạng thái được ghi lịch sử và gửi email cho khách (khi đã cấu hình RESEND_API_KEY).
const Store = require('./store');
const Mailer = require('./mailer');
const Throttle = require('./throttle');

const KINDS = {
  PRIVATE_SHOW: 'Private Show – thuê nguyên phòng chiếu',
  GROUP: 'Vé nhóm (từ 20 người)',
  EVENT: 'Hội nghị, sự kiện, ra mắt phim',
  ADS: 'Quảng cáo tại rạp'
};
const STATUS = { NEW: 'Mới – chờ CSKH liên hệ', QUOTED: 'Đã gửi báo giá', CONFIRMED: 'Đã chốt', DONE: 'Đã tổ chức', CANCELLED: 'Đã hủy' };
const NEXT = { NEW: ['QUOTED', 'CANCELLED'], QUOTED: ['QUOTED', 'CONFIRMED', 'CANCELLED'], CONFIRMED: ['DONE', 'CANCELLED'], DONE: [], CANCELLED: [] };

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + ' đ';
const genCode = () => 'EV-' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

const pub = (e) => ({
  code: e.code, kind: e.kind, kind_label: KINDS[e.kind] || e.kind, status: e.status, status_label: STATUS[e.status] || e.status,
  cinema_id: e.cinema_id, cinema: e.cinema_name, date: e.date, time: e.time, guests: e.guests, movie: e.movie_title || null,
  quote_amount: e.quote_amount || null, quote_note: e.quote_note || null, created_at: e.created_at, updated_at: e.updated_at
});

async function create(b, customer = null) {
  const kind = str(b.kind).toUpperCase();
  if (!KINDS[kind]) throw httpError('Chọn loại yêu cầu', 400);
  const name = str(b.contact_name, 80), phone = str(b.phone, 20).replace(/[\s.-]/g, ''), email = str(b.email, 120).toLowerCase();
  if (name.length < 2) throw httpError('Nhập họ tên người liên hệ', 400);
  if (!/^(0|\+84)\d{9,10}$/.test(phone)) throw httpError('Số điện thoại không hợp lệ', 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('Email không hợp lệ', 400);
  const guests = Math.round(Number(b.guests) || 0);
  if (!(guests >= 1 && guests <= 2000)) throw httpError('Nhập số khách dự kiến (1–2000)', 400);
  if (kind === 'GROUP' && guests < 20) throw httpError('Vé nhóm áp dụng từ 20 người', 400);
  const date = str(b.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError('Ngày không hợp lệ', 400);
  if (date && new Date(date + 'T23:59:59+07:00') < new Date()) throw httpError('Ngày tổ chức phải từ hôm nay trở đi', 400);
  if (date) { const max = new Date(); max.setMonth(max.getMonth() + 12); if (new Date(date + 'T00:00:00+07:00') > max) throw httpError('Chỉ nhận đặt trước tối đa 12 tháng', 400); }
  const time = str(b.time, 5);
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw httpError('Giờ không hợp lệ', 400);
  if (time && (time < '08:00' || time > '23:00')) throw httpError('Giờ tổ chức trong khung 08:00 – 23:00', 400);
  if (String(b.note || '').trim().length > 1000) throw httpError('Ghi chú tối đa 1.000 ký tự', 400);
  const cinema = b.cinema_id ? await Store.one('cinemas', { id: str(b.cinema_id) }) : null;
  if (b.cinema_id && !cinema) throw httpError('Rạp không tồn tại', 400);
  const movie = b.movie_id ? await Store.one('movies', { id: str(b.movie_id) }) : null;
  // Chống spam: tối đa 5 yêu cầu / 15 phút / số điện thoại
  await Throttle.check('ev:' + phone);
  await Throttle.fail('ev:' + phone, 5);
  const now = new Date().toISOString();
  let row;
  for (let i = 0; i < 3 && !row; i++) {
    try {
      row = await Store.insert('event_requests', {
        code: genCode(), kind, status: 'NEW', cinema_id: cinema ? cinema.id : null, cinema_name: cinema ? cinema.name : null,
        date: date || null, time: time || null, guests, movie_id: movie ? movie.id : null, movie_title: movie ? movie.title : str(b.movie_text, 120) || null,
        contact_name: name, phone, email: email || null, company: str(b.company, 120) || null, note: str(b.note, 1000) || null,
        customer_id: customer ? customer.id : null, history: [{ at: now, status: 'NEW', by: 'Khách', note: 'Gửi yêu cầu' }], updated_at: now
      });
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  if (email) await Mailer.send({ to: email, title: 'Đã nhận yêu cầu ' + row.code, message: `Beta Cinemas đã nhận yêu cầu "${KINDS[kind]}" (${guests} khách). CSKH sẽ liên hệ số ${phone} trong 1 ngày làm việc để báo giá.` }).catch(() => null);
  return pub(row);
}

// Khách tra cứu: cần đúng mã + số điện thoại đã gửi
async function lookup(code, phone) {
  const e = await Store.one('event_requests', { code: str(code, 20).toUpperCase() });
  if (!e || e.phone !== str(phone, 20).replace(/[\s.-]/g, '')) throw httpError('Không tìm thấy yêu cầu với mã và số điện thoại này', 404);
  return pub(e);
}

async function adminList({ status } = {}) {
  const f = status ? { status } : {};
  return Store.find('event_requests', f, { limit: 300 });
}

async function update(b, staff) {
  const e = await Store.one('event_requests', { code: str(b.code, 20) });
  if (!e) throw httpError('Không tìm thấy yêu cầu', 404);
  const to = str(b.status).toUpperCase();
  if (!STATUS[to]) throw httpError('Trạng thái không hợp lệ', 400);
  if (to !== e.status && !NEXT[e.status].includes(to)) throw httpError(`Không chuyển được từ "${STATUS[e.status]}" sang "${STATUS[to]}"`, 409);
  const patch = { status: to, updated_at: new Date().toISOString(), staff_note: str(b.staff_note, 1000) || e.staff_note || null };
  if (to === 'QUOTED') {
    const amount = Math.round(Number(b.quote_amount) || 0);
    if (!(amount > 0)) throw httpError('Nhập số tiền báo giá', 400);
    patch.quote_amount = amount;
    patch.quote_note = str(b.quote_note, 1000) || null;
  }
  patch.history = [...(Array.isArray(e.history) ? e.history : []), { at: patch.updated_at, status: to, by: staff ? staff.full_name : 'Hệ thống', note: str(b.quote_note || b.staff_note, 300) || null }];
  const [u] = await Store.update('event_requests', { code: e.code, status: e.status }, patch);
  if (!u) throw httpError('Yêu cầu vừa được người khác cập nhật, tải lại để xem', 409);
  if (u.email && to !== e.status) {
    const msg = to === 'QUOTED' ? `Báo giá cho yêu cầu ${u.code}: ${vnd(u.quote_amount)}.${u.quote_note ? ' ' + u.quote_note : ''} Vui lòng phản hồi CSKH để chốt.`
      : to === 'CONFIRMED' ? `Yêu cầu ${u.code} đã được chốt${u.date ? ' cho ngày ' + u.date.split('-').reverse().join('/') : ''}. Hẹn gặp bạn tại ${u.cinema_name || 'Beta Cinemas'}.`
      : to === 'CANCELLED' ? `Yêu cầu ${u.code} đã được hủy. Liên hệ Trung tâm hỗ trợ trên website nếu bạn cần hỗ trợ thêm.` : null;
    if (msg) await Mailer.send({ to: u.email, title: STATUS[to] + ' – ' + u.code, message: msg }).catch(() => null);
  }
  return u;
}

module.exports = { KINDS, STATUS, create, lookup, adminList, update, pub };
