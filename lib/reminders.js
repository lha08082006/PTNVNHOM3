// lib/reminders.js - Thư nhắc tự động (Đợt 2), chạy trong Job hằng ngày (Vercel Cron 08:00 giờ VN).
//   - Nhắc suất chiếu trong ngày cho đơn đã xuất vé
//   - Mời đánh giá phim cho khách đã soát vé hôm qua / hôm kia
//   - Beta Club: quà sinh nhật, điểm sắp hết hạn (30 ngày tới)
// Mỗi thư chỉ gửi một lần: kiểm tra bảng notifications trước khi gửi.
const Store = require('./store');
const Flow = require('./flow');
const Mailer = require('./mailer');
const Points = require('./points');
const Ticket = require('./ticket');

const H = 3600e3;
const iso = (d) => new Date(d).toISOString();
const vnDate = (d) => new Date(new Date(d).getTime() + 7 * H).toISOString().slice(0, 10);
const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];

async function sent(orderCode, event, sinceMs = null) {
  const rows = await Store.find('notifications', { order_code: orderCode, event }, { limit: 1 });
  return rows.some(r => sinceMs == null || Date.now() - new Date(r.created_at).getTime() < sinceMs);
}

// Thư cho khách (không gắn với đơn): ghi vào notifications với order_code = "CUS:<id>"
async function mailCustomer(c, event, title, message) {
  const key = 'CUS:' + c.id;
  let recipient = c.email;
  const r = await Mailer.send({ to: c.email, title, message });
  recipient += r.sent ? ' (đã gửi)' : r.reason === 'not-configured' ? ' (chưa cấu hình email)' : ' (lỗi gửi)';
  await Store.insert('notifications', { order_code: key, channel: 'EMAIL', event, title, message, recipient });
}

async function run(now = new Date()) {
  const out = { show_reminders: 0, review_invites: 0, birthday: 0, points_expiring: 0, points_expired: 0, on_sale: 0 };
  const today = vnDate(now);
  const orders = await Store.find('orders', { status: { in: PAID }, show_at: { gte: iso(now.getTime() - 48 * H), lte: iso(now.getTime() + 24 * H) } }, { limit: 2000 });
  for (const o of orders) {
    if ((o.kind || 'TICKET') !== 'TICKET' || !o.show_at) continue;
    const at = new Date(o.show_at).getTime();
    // Suất chiếu hôm nay, chưa chiếu
    if (at > now.getTime() && vnDate(at) === today && !(await sent(o.code, 'SHOW_REMINDER'))) {
      await Flow.notify(o, 'SHOW_REMINDER', 'Hôm nay bạn có suất chiếu',
        `Nhắc bạn: suất ${o.show_time} ngày ${o.show_date} tại ${o.cinema}, ghế ${(o.seats || []).join(', ')}. Vui lòng có mặt trước 15 phút và mở vé QR trong mục Tài khoản (xem được cả khi mất mạng nếu đã mở trước).`, ['WEB', 'EMAIL']);
      out.show_reminders++;
    }
    // Đã xem (đã soát vé), suất kết thúc ít nhất 2 giờ -> mời đánh giá
    if (at < now.getTime() - 2 * H && o.user_id && !(await sent(o.code, 'REVIEW_INVITE'))
      && (await Ticket.lastCheckin(o.id)) && !(await Store.one('movie_reviews', { order_code: o.code }))) {
      await Flow.notify(o, 'REVIEW_INVITE', 'Bạn thấy phim thế nào?',
        `Cảm ơn bạn đã xem phim tại ${o.cinema}. Chấm điểm phim trong trang chi tiết phim để giúp khán giả khác chọn phim – chỉ khách đã xem mới đánh giá được.`, ['WEB', 'EMAIL']);
      out.review_invites++;
    }
  }

  // "Nhắc tôi khi mở bán" (Đợt 3): phim vừa có suất chiếu -> báo cho khách đã đăng ký, mỗi lần đăng ký chỉ báo 1 lần
  const watches = await Store.find('movie_watches', { notified_at: { is: null } }, { order: null, limit: 20000 });
  const onSale = {};
  for (const w of watches) {
    if (!(w.movie_id in onSale)) {
      const st = (await Store.find('showtimes', { movie_id: w.movie_id, starts_at: { gte: iso(now) } }, { order: 'starts_at', asc: true, limit: 20 })).find(s => s.active !== false);
      onSale[w.movie_id] = st ? (await Store.one('movies', { id: w.movie_id })) : null;
    }
    const m = onSale[w.movie_id];
    if (!m) continue;
    const c = await Store.one('customers', { id: w.customer_id });
    const [u] = await Store.update('movie_watches', { id: w.id, notified_at: { is: null } }, { notified_at: iso(now) });
    if (!c || !u) continue;
    await mailCustomer(c, 'MOVIE_ON_SALE', 'Đã mở bán vé ' + m.title,
      `Phim "${m.title}" bạn đăng ký nhắc đã có suất chiếu. Đặt vé sớm để chọn được chỗ đẹp tại trang chi tiết phim.`);
    out.on_sale++;
  }

  const p = await Points.daily(now);
  out.points_expired = p.expired;
  // Quà sinh nhật vừa cộng hôm nay -> báo cho khách
  const bdays = await Store.find('point_ledger', { kind: 'BIRTHDAY', created_at: { gte: iso(now.getTime() - 24 * H) } }, { limit: 5000 });
  for (const b of bdays) {
    const c = await Store.one('customers', { id: b.customer_id });
    if (!c || (await sent('CUS:' + c.id, 'BIRTHDAY', 300 * 24 * H))) continue;
    await mailCustomer(c, 'BIRTHDAY', 'Chúc mừng sinh nhật từ Beta Cinemas',
      `Beta Club tặng bạn ${b.points} điểm (= ${(b.points * 1000).toLocaleString('vi-VN')} đ) để dùng khi đặt vé trong 60 ngày. Chúc bạn sinh nhật vui vẻ!`);
    out.birthday++;
  }
  // Điểm sắp hết hạn: nhắc tối đa 1 lần / 25 ngày
  for (const { customer: c, points } of p.expiring) {
    if (await sent('CUS:' + c.id, 'POINTS_EXPIRING', 25 * 24 * H)) continue;
    await mailCustomer(c, 'POINTS_EXPIRING', 'Điểm Beta Club sắp hết hạn',
      `Bạn có ${points} điểm (= ${(points * 1000).toLocaleString('vi-VN')} đ) sẽ hết hạn trong 30 ngày tới. Dùng điểm để trả tiền vé hoặc bắp nước ở bước thanh toán.`);
    out.points_expiring++;
  }
  return out;
}

module.exports = { run };
