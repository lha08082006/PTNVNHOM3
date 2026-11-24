// js/ticket-cancelled.js - mã của ticket-cancelled.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(function initCancelledPage() {
  const params = new URLSearchParams(window.location.search);
  const order = params.get('order') || '';
  // Trang mẫu: chỉ hiện khi mở kèm mã đơn; không tự bịa đơn / mã hoàn tiền mẫu
  if (!order) {
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = '<div class="container" style="padding: 60px 20px; text-align: center;"><h1 style="font-size: 22px; margin-bottom: 12px;">Không có thông tin đơn</h1><p style="color: #475569; margin-bottom: 16px;">Xem đơn đã hủy và tiền hoàn trong Tài khoản → Lịch sử đơn hàng.</p><a class="btn btn-primary" href="account.html">Mở Tài khoản</a></div>';
    return;
  }
  const movieKey = params.get('movie') || 'quy-an-tang-4';
  const total = Number(params.get('total') || 90000);
  const cinema = params.get('cinema') || 'Beta Thanh Xuân (Hà Nội)';
  const seats = params.get('seats') || 'D5, D6';
  const date = params.get('date') || 'Hôm nay';
  const time = params.get('time') || '18:30';
  const refundCode = params.get('refund_code') || ('REF-' + order.slice(-6));

  const movieTitle = (movieKey === 'quy-an-tang-4') ? 'Quỷ Ăn Tạng 4' : 'Trại Buôn Người: Vùng Cấm Biên Giới';
  const poster = (movieKey === 'quy-an-tang-4')
    ? 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.webp'
    : 'images/official-poster-trai-buon-nguoi-final-142318-150926-62.webp';

  const totalFmt = total.toLocaleString('vi-VN') + ' đ';

  const ordEl = document.getElementById('cancel-order-code');
  if (ordEl) ordEl.textContent = order;
  const tEl = document.getElementById('cancel-movie-title');
  if (tEl) tEl.textContent = movieTitle;
  const pEl = document.getElementById('cancel-movie-poster');
  if (pEl) pEl.src = poster;
  const cEl = document.getElementById('cancel-cinema');
  if (cEl) cEl.textContent = cinema;
  const stEl = document.getElementById('cancel-showtime');
  if (stEl) stEl.textContent = `${time} • ${date}`;
  const sEl = document.getElementById('cancel-seats');
  if (sEl) sEl.textContent = seats;
  const totEl = document.getElementById('cancel-total');
  if (totEl) totEl.textContent = totalFmt;
  const refEl = document.getElementById('cancel-refund-amount');
  if (refEl) refEl.textContent = `+${totalFmt} (VietQR)`;
  const noteEl = document.getElementById('cancel-note-seats');
  if (noteEl) noteEl.textContent = seats;
  const rcEl = document.getElementById('cancel-ref-code');
  if (rcEl) rcEl.textContent = refundCode;
})();
