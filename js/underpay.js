// js/underpay.js - mã của underpay.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
function copyText(str) {
  navigator.clipboard.writeText(str);
  alert('Đã sao chép: ' + str);
}

const params = new URLSearchParams(window.location.search);
let orderCode = (params.get('order') || '').toUpperCase();
// Đợt 10: mở trang mà không có mã đơn -> không hiện số liệu mẫu, hướng khách đi tra cứu
function showMissingOrder() {
  const main = document.querySelector('main') || document.body;
  main.innerHTML = '<section style="max-width: 520px; margin: 40px auto; padding: 28px 22px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; text-align: center;">' +
    '<h1 style="font-size: 22px; color: #005198; margin: 0 0 8px;">Thiếu mã đơn hàng</h1>' +
    '<p style="color: #475569; margin: 0 0 18px; line-height: 1.6;">Trang này mở từ một đơn hàng cụ thể. Nhập mã đơn (BC…) để tra cứu, hoặc xem lịch sử đặt vé trong tài khoản.</p>' +
    '<div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;"><a class="btn btn-primary" href="order.html">Tra cứu đơn hàng</a><a class="btn btn-outline" href="account.html">Tài khoản của tôi</a></div></section>';
}
// Chạy sau khi các đoạn mã còn lại của trang đã gắn sự kiện xong (chúng tìm phần tử trong <main>)
if (!orderCode) document.addEventListener('DOMContentLoaded', showMissingOrder);
let total = Number(params.get('total') || 179000);
let currentPaid = Number(params.get('paid') || Math.max(50000, total - 79000));
let currentRemaining = Number(params.get('remaining') || (total - currentPaid));
if (currentRemaining <= 0) currentRemaining = 79000;
const movie = params.get('movie') || '';
const cinema = params.get('cinema') || '';
const seats = params.get('seats') || '';
const date = params.get('date') || '';
const time = params.get('time') || '';
const combos = params.get('combos') || '';

function copyOrderCode() { copyText(orderCode); }
function copyRemainAmount() { copyText(currentRemaining.toString()); }

const fullQueryParams = new URLSearchParams({
  order: orderCode,
  movie: movie,
  cinema: cinema,
  seats: seats,
  total: total,
  date: date,
  time: time
});

// Cập nhật giao diện đơn hàng
function renderOrderData(ord) {
  if (!ord) return;
  orderCode = ord.code;
  total = ord.total || total;
  currentRemaining = ord.remaining_amount || (total - (ord.paid_amount || currentPaid));

  document.getElementById('underpay-order-code').textContent = ord.code;
  document.getElementById('copy-transfer-content').textContent = ord.code;

  document.getElementById('underpay-total-amount').textContent = Pay.vnd(total);
  document.getElementById('underpay-paid-amount').textContent = Pay.vnd(ord.paid_amount || currentPaid);
  document.getElementById('underpay-remaining-amount').textContent = Pay.vnd(currentRemaining);
  document.getElementById('copy-remain-amount').textContent = Pay.vnd(currentRemaining);

  // Đồng bộ toàn bộ thông tin hóa đơn động chuẩn xác
  if (window.Pay && Pay.renderInvoice) {
    Pay.renderInvoice({
      ...ord,
      movie_key: ord.movie_key || movie,
      cinema: ord.cinema || cinema,
      show_date: ord.show_date || date,
      show_time: ord.show_time || time,
      seats: ord.seats || seats
    });
  }

  // Tạo mã VietQR SePay đúng số tiền còn thiếu
  const qrImg = document.getElementById('underpay-qr-img');
  if (qrImg) {
    qrImg.onerror = function() { this.onerror = null; this.src = 'https://qr.sepay.vn/img?acc=96886693088500&bank=MSB&amount=' + currentRemaining + '&des=' + encodeURIComponent(ord.code); };
    qrImg.onload = function() { this.style.visibility = 'visible'; };
    qrImg.src = 'https://qr.sepay.vn/img?acc=96886693088500&bank=MSB&amount=' + currentRemaining + '&des=' + encodeURIComponent(ord.code);
  }
}

// Dữ liệu thật từ máy chủ: số đã nhận, số còn thiếu, thời gian giữ ghế còn lại
let secondsLeft = 0;
let leaving = false;
function onUpdate(ord) {
  if (!ord || leaving) return;
  if (ord.status === 'PENDING') {
    renderOrderData(ord);
    secondsLeft = ord.seconds_left;
    return;
  }
  // Đã chuyển đủ -> vé; hết giờ khi chưa đủ -> hoàn phần đã nhận (theo dõi tại order.html)
  leaving = true;
  location.href = Pay.routeFor(ord);
}
if (orderCode) Pay.watch(orderCode, onUpdate, 3000);

function checkUnderpayStatus() {
  Pay.getOrder(orderCode).then(ord => {
    if (ord && ord.status !== 'PENDING') return onUpdate(ord);
    alert(`Hệ thống đang đợi nhận thêm ${Pay.vnd(currentRemaining)} từ ngân hàng. Vui lòng quét mã QR chuyển bù hoặc thử lại sau vài giây!`);
  });
}

// Bảng giả lập chỉ hiện khi phát triển trên máy hoặc mở với ?sandbox=1 (giống gateway.html)
(function () {
  const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!devHost && new URLSearchParams(location.search).get('sandbox') !== '1') {
    document.querySelectorAll('.sandbox-box').forEach((el) => el.remove());
  }
})();

// Sandbox: chuyển nốt phần còn thiếu
async function demoPayRemaining() {
  try {
    const r = await Pay.simulate('TOPUP', orderCode);
    onUpdate(r.order);
  } catch (e) { alert(e.message); }
}

// Sandbox: tua tới lúc hết 10 phút giữ ghế khi vẫn chưa đủ tiền -> hệ thống tự hoàn phần đã nhận
async function demoExpireOrder() {
  try {
    const r = await Pay.simulate('SHIFT', orderCode, null, { minutes: Math.ceil(secondsLeft / 60) + 1 });
    onUpdate(r.order);
  } catch (e) { alert(e.message); }
}

const countdownEl = document.getElementById('underpay-countdown');
setInterval(() => {
  if (secondsLeft > 0) {
    secondsLeft--;
    const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
    const s = (secondsLeft % 60).toString().padStart(2, '0');
    if (countdownEl) countdownEl.textContent = `${m}:${s}`;
  }
}, 1000);
