// js/redirect-to-order.js - trang mẫu ticket-cancelled.html / ticket-refunded.html chuyển ngay sang order.html (CSP không cho script inline)
// Trang mẫu thiết kế: trạng thái đơn thật (đã hủy / đã hoàn tiền) hiển thị ở order.html
(function () {
  var c = new URLSearchParams(location.search).get("order");
  location.replace(c ? "order.html?code=" + encodeURIComponent(c) : "account.html");
})();
