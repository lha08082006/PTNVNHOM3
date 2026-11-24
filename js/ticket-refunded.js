// js/ticket-refunded.js - mã của ticket-refunded.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// 1. Phân tích tham số từ URL
const urlParams = new URLSearchParams(window.location.search);
const orderCode = urlParams.get('order') || localStorage.getItem('last_active_order') || 'BC2610279854';

// 2. Tra cứu dữ liệu từ localStorage
let refundDet = null;
try {
  const stored = localStorage.getItem('refund_detail_' + orderCode);
  if (stored) refundDet = JSON.parse(stored);
} catch (e) {}

// Tra cứu từ pay-client nếu có
const localOrd = (window.Pay && Pay.getLocalOrder) ? Pay.getLocalOrder(orderCode) : null;

// Trích xuất các trường dữ liệu
const movieKey = (refundDet && refundDet.movie) || urlParams.get('movie') || (localOrd && localOrd.movie_key) || 'quy-an-tang-4';
const cinema = (refundDet && refundDet.cinema) || urlParams.get('cinema') || (localOrd && localOrd.cinema) || 'Beta Thanh Xuân (Hà Nội)';
const seats = (refundDet && refundDet.seats) || urlParams.get('seats') || (localOrd && (Array.isArray(localOrd.seats) ? localOrd.seats.join(', ') : localOrd.seats)) || 'D5, D6';
const rawCombos = (refundDet && refundDet.combos) || urlParams.get('combos') || '';
const date = (refundDet && refundDet.date) || urlParams.get('date') || 'Hôm nay';
const time = (refundDet && refundDet.time) || urlParams.get('time') || '18:30';
const total = Number((refundDet && refundDet.total) || urlParams.get('total') || (localOrd && localOrd.total) || 179000);
const bank = (refundDet && refundDet.bank) || urlParams.get('bank') || 'MB Bank (Ngân hàng Quân Đội)';
const acc = (refundDet && refundDet.acc) || urlParams.get('acc') || '';
const owner = (refundDet && refundDet.owner) || urlParams.get('owner') || '';
const refundCode = (refundDet && refundDet.refund_code) || urlParams.get('refund_code') || ('REF-' + orderCode.slice(-6));

// Dữ liệu mặc định chuẩn cho đơn Trại Buôn Người nếu mở BC2610208819
const isTraiBuonNguoi = (orderCode === 'BC2610208819') || (movieKey === 'trai-buon-nguoi');

// Xử lý tên phim và poster
const movieObj = (window.Pay && Pay.getMovie) ? Pay.getMovie(movieKey) : null;
let movieTitle = isTraiBuonNguoi ? 'Trại Buôn Người: Vùng Cấm Biên Giới' : ((movieObj && (movieObj.shortTitle || movieObj.title)) || 'Quỷ Ăn Tạng 4');
let poster = isTraiBuonNguoi ? 'images/official-poster-trai-buon-nguoi-final-142318-150926-62.webp' : ((movieObj && movieObj.poster) || 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.webp');
let movieAge = isTraiBuonNguoi ? 'T18' : 'C18';
let movieGenre = isTraiBuonNguoi ? 'Tâm Lý, Tội Phạm · 118 phút · 2D phụ đề' : 'Kinh Dị, Giật Gân · 110 phút · 2D phụ đề';
let actualCinema = isTraiBuonNguoi ? 'Beta Thanh Xuân (HN) · Phòng 02' : (`${cinema} · Phòng 01`);
let actualShowtime = isTraiBuonNguoi ? '20/10/2026 · 21:00' : (`${date} · ${time}`);
let actualSeats = isTraiBuonNguoi ? 'G09, G10' : seats;
let actualCombos = isTraiBuonNguoi ? 'Combo Solo (1 Bắp Ngọt + 1 Coca) × 1' : combosText;
let actualTotal = isTraiBuonNguoi ? '180.000 đ' : formattedTotal;
let actualRefundCode = isTraiBuonNguoi ? 'REF-2610-889' : refundCode;
let actualTransCode = isTraiBuonNguoi ? 'FT26102088198842' : transCode;
let actualRefundTime = isTraiBuonNguoi ? '20/10/2026 17:45' : fullRefundTime;

// Mask số tài khoản: ví dụ 0987654321 -> ****4321
const cleanBank = bank.split('(')[0].trim();
const last4Acc = acc.length >= 4 ? acc.slice(-4) : acc;
const maskedAccText = `${cleanBank} ****${last4Acc}`;

// Format tiền VND
const formattedTotal = (window.Pay && Pay.vnd) ? Pay.vnd(total) : total.toLocaleString('vi-VN') + ' đ';

// Xử lý chuỗi combo
let combosText = 'Không kèm bắp nước';
if (rawCombos) {
  if (typeof rawCombos === 'string' && rawCombos.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawCombos);
      const parts = [];
      for (let k in parsed) {
        parts.push(`Combo (${k}) × ${parsed[k]}`);
      }
      if (parts.length > 0) combosText = parts.join(', ');
    } catch (e) {
      combosText = rawCombos;
    }
  } else {
    combosText = rawCombos;
  }
} else {
  combosText = 'Combo 1 (1 Bắp Ngọt + 1 Coca) × 1';
}

// Thời gian hoàn tiền (mặc định lấy thời điểm hiện tại hoặc lùi vài phút)
const now = new Date();
const pad = (n) => n.toString().padStart(2, '0');
const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
const dateFormatted = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
const fullRefundTime = `${dateFormatted} ${timeFormatted}`;

// Tạo mã giao dịch ngân hàng
const transCode = 'FT' + orderCode.slice(-8) + Math.floor(1000 + Math.random() * 9000);

// Gán dữ liệu vào HTML
document.getElementById('order-code-display').textContent = orderCode;
document.getElementById('movie-title').innerHTML = `${movieTitle} <span id="movie-age-badge" style="background: #d14400; color: white; font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 6px; vertical-align: middle; margin-left: 4px;">${movieAge}</span>`;
document.getElementById('movie-meta').textContent = movieGenre;
document.getElementById('movie-poster').src = poster;
document.getElementById('cinema-room').textContent = actualCinema;
document.getElementById('showtime-date').textContent = actualShowtime;
document.getElementById('seats-display').textContent = actualSeats;
document.getElementById('combos-display').textContent = actualCombos;
document.getElementById('total-display').textContent = actualTotal;

document.getElementById('refund-code-display').textContent = actualRefundCode;
document.getElementById('refund-amount-display').textContent = actualTotal;
document.getElementById('refund-bank-acc').textContent = maskedAccText;
document.getElementById('refund-trans-code').textContent = actualTransCode;
document.getElementById('refund-time-display').textContent = actualRefundTime;
document.getElementById('top-user-name').textContent = owner;

// Cập nhật mốc thời gian lịch sử đơn
const t0 = new Date(now.getTime() - 15 * 60000);
const t1 = new Date(now.getTime() - 10 * 60000);
const t2 = new Date(now.getTime() - 5 * 60000);
const formatStepTime = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} · Hoàn tất`;

if (isTraiBuonNguoi) {
  document.getElementById('time-step-1').textContent = '20/10/2026 17:30 · Hoàn tất';
  document.getElementById('time-step-2').textContent = '20/10/2026 17:35 · Hoàn tất';
  document.getElementById('time-step-3').textContent = '20/10/2026 17:40 · Hoàn tất';
  document.getElementById('time-step-4').textContent = '20/10/2026 17:45 · Hoàn tất';
} else {
  document.getElementById('time-step-1').textContent = formatStepTime(t0);
  document.getElementById('time-step-2').textContent = formatStepTime(t1);
  document.getElementById('time-step-3').textContent = formatStepTime(t2);
  document.getElementById('time-step-4').textContent = `${fullRefundTime} · Hoàn tất`;
}

// Cập nhật link xem hóa đơn điện tử
const invoiceLink = document.getElementById('link-view-invoice');
if (invoiceLink) {
  invoiceLink.href = 'invoice.html?order=' + encodeURIComponent(orderCode);
}
