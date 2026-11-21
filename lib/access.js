// lib/access.js - Ai được xem gì của một đơn hàng
//   owner  : thành viên đã đăng nhập và là chủ đơn      -> xem đầy đủ (kể cả mã vạch vào rạp)
//   staff  : nhân viên nội bộ đã đăng nhập              -> xem đầy đủ
//   public : chỉ biết mã đơn (mã đơn nằm trong nội dung chuyển khoản, sao kê, ảnh chụp màn hình...)
//            -> chỉ thấy trạng thái đơn; KHÔNG có tên/SĐT/email, mã vạch / QR vé, lịch sử, thông báo, tài khoản ngân hàng
const Auth = require('./auth');
const Staff = require('./staff');
const Flow = require('./flow');

async function relation(req, order) {
  const me = await Auth.currentCustomer(req);
  if (me && order && order.user_id && order.user_id === me.id) return 'owner';
  if (await Staff.current(req)) return 'staff';
  return 'public';
}

const redactRefund = (r) => r && ({ ...r, source_account: null, refund_ref: null, tx_refs: null, cs_note: null });

function redact(v) {
  // eslint-disable-next-line no-unused-vars
  const { phone, email, customer_name, ticket_qr, ticket_barcode, notifications, history, tickets, ...rest } = v;
  return {
    ...rest,
    refunds: (v.refunds || []).map(redactRefund),
    refund: redactRefund(v.refund),
    limited: true // trình duyệt biết đây là bản rút gọn để mời đăng nhập đúng tài khoản
  };
}

// Dữ liệu đơn trả cho trình duyệt, đã lọc theo quyền của người hỏi
async function viewFor(req, order) {
  const v = await Flow.view(order);
  return (await relation(req, order)) === 'public' ? redact(v) : v;
}

module.exports = { relation, redact, viewFor };
