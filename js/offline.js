// js/offline.js - mã của offline.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(function () {
  var net = document.getElementById('net');
  function paint() {
    net.textContent = navigator.onLine ? 'Đang có mạng' : 'Đang mất mạng';
    net.style.background = navigator.onLine ? '#dcfce7' : '#fee2e2';
    net.style.color = navigator.onLine ? '#166534' : '#991b1b';
  }
  paint();
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf('BETA_ORDER_') !== 0) continue;
      var o = JSON.parse(localStorage.getItem(k) || 'null');
      if (o && o.has_ticket && o.ticket_qr) out.push(o);
    }
  } catch (e) { /* trình duyệt chặn bộ nhớ: không có vé lưu */ }
  out.sort(function (a, b) { return String(b.show_at || b.created_at).localeCompare(String(a.show_at || a.created_at)); });
  document.getElementById('list').innerHTML = out.length ? out.map(function (o) {
    var title = o.kind === 'FNB' ? 'Đơn bắp nước' : ((o.movie && o.movie.title) || o.movie_key || 'Vé xem phim');
    var when = o.kind === 'FNB' ? 'Nhận tại quầy ' + (o.cinema || '') : [o.show_time, o.show_date, o.cinema].filter(Boolean).join(' · ');
    return '<a class="t" href="ticket.html?order=' + encodeURIComponent(o.code) + '"><b>' + esc(title) + '</b>' +
      '<small>' + esc(when) + (o.seats && o.seats.length ? ' · Ghế ' + esc(o.seats.join(', ')) : '') + '</small>' +
      '<small>Mã đơn ' + esc(o.code) + (o.checked_in_at ? ' · đã soát vé' : '') + '</small></a>';
  }).join('') : '<p class="lead">Chưa có vé nào được lưu trên thiết bị này.</p>';
})();
