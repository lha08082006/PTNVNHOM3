// js/refund-track.js - mã của refund-track.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Tiến trình hoàn tiền nay hiển thị ở trang Theo dõi đơn hàng (order.html), thanh 4 mốc theo dữ liệu thật.
// Trang này chỉ chuyển hướng để các liên kết cũ vẫn dùng được; mã demo không có trên máy chủ thì giữ giao diện mẫu.
(async () => {
  const p = new URLSearchParams(location.search);
  const order = (p.get('order') || '').toUpperCase();
  const code = p.get('code') || '';
  try {
    const o = code ? await Pay.getRefunds({ code }) : order ? await Pay.getRefunds({ order_code: order }) : null;
    if (o && o.code) return location.replace('order.html?code=' + encodeURIComponent(o.code));
  } catch (e) {}
  // Không có đơn thật: chỉ giữ giao diện mẫu khi đang thiết kế (localhost / ?dev=1)
  const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || p.has('dev');
  if (!dev) location.replace(order ? 'order.html?code=' + encodeURIComponent(order) : 'account.html');
})();
