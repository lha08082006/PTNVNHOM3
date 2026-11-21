// lib/routes/order-action.js (phục vụ tại /api/order-action) - Thao tác của chính chủ đơn hàng (phải đăng nhập, đơn thuộc tài khoản):
//   POST ?action=cancel        hủy đơn đang chờ thanh toán (chưa chuyển tiền) để nhả ghế ngay
//   POST ?action=resend-ticket gửi lại vé điện tử qua email (tối đa 3 lần / 15 phút mỗi đơn)
const Store = require('../store');
const Flow = require('../flow');
const Auth = require('../auth');
const Mailer = require('../mailer');
const Throttle = require('../throttle');
const { fail, orderCodeOf, clean } = require('../api-util');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const action = clean((req.query && req.query.action) || (req.body && req.body.action));
    const me = await Auth.currentCustomer(req);
    if (!me) throw httpError('Vui lòng đăng nhập để thao tác với đơn hàng.', 401);
    const code = orderCodeOf(req);
    const order = code ? await Store.one('orders', { code }) : null;
    // Không phân biệt "không tồn tại" và "không phải của bạn" để tránh dò mã đơn
    if (!order || order.user_id !== me.id) throw httpError('Không tìm thấy đơn hàng #' + code + ' trong tài khoản của bạn.', 404);

    if (action === 'cancel') {
      const after = await Flow.cancelByCustomer(order);
      return res.status(200).json(await Flow.view(after || (await Store.one('orders', { code }))));
    }

    if (action === 'resend-ticket') {
      if (!['CONFIRMED', 'CONFIRMED_LATE'].includes(order.status)) throw httpError('Đơn chưa xuất vé nên chưa có vé để gửi.', 409);
      if (!order.email) throw httpError('Đơn không có email nhận vé. Vui lòng cập nhật email trong Thông tin cá nhân.', 409);
      const key = 'm:' + order.code;
      await Throttle.check(key);
      await Throttle.fail(key, 3);
      const seats = Array.isArray(order.seats) ? order.seats.join(', ') : String(order.seats || '');
      const message = `Vé đơn ${order.code}: ${order.cinema || ''} · ${[order.show_time, order.show_date].filter(Boolean).join(' ')} · Ghế ${seats} · ${vnd(order.total)}. ` +
        'Mở trang đơn hàng để xem mã vạch soát vé.';
      const r = await Mailer.send({ to: order.email, title: 'Vé điện tử Beta Cinemas – ' + order.code, message, orderCode: order.code });
      await Store.insert('notifications', {
        order_code: order.code, channel: 'EMAIL', event: 'TICKET_RESENT', title: 'Gửi lại vé điện tử', message,
        recipient: order.email + (r.sent ? ' (đã gửi)' : r.reason === 'not-configured' ? ' (chưa cấu hình gửi mail)' : ' (lỗi gửi)')
      }).catch(() => {});
      if (!r.sent && r.reason !== 'not-configured') throw httpError('Chưa gửi được email, vui lòng thử lại sau ít phút.', 502);
      return res.status(200).json({ ok: true, sent: !!r.sent, email: order.email.replace(/^(.).*(@.*)$/, '$1***$2') });
    }

    throw httpError('Hành động không hỗ trợ: ' + action, 400);
  } catch (e) {
    return fail(res, e);
  }
};
