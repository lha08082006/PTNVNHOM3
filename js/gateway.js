// js/gateway.js - mã của gateway.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Tầng 1 – trong 10 phút giữ ghế. Đồng hồ và trạng thái lấy từ MÁY CHỦ (trình duyệt không tự quyết):
// chờ Webhook 2 phút -> Short Polling 15 giây/lần -> Final Check 3 phút/lần -> tra cứu chốt lúc 10:00.
const params = new URLSearchParams(window.location.search);
const orderCode = (params.get('order') || '').toUpperCase();
let order = null;
let secondsLeft = 600;
let hasRedirected = false;
let isReportUnlocked = false;
let isReportSubmitted = false;

// Bảng sandbox (mô phỏng ngân hàng) chỉ hiện khi phát triển trên máy hoặc mở với ?sandbox=1
const isDevHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (!isDevHost && params.get('sandbox') !== '1') {
  const sb = document.getElementById('sandbox-details');
  if (sb) sb.remove();
} else if (!isDevHost) {
  // ?sandbox=1 trên web thật: chỉ giữ bảng khi máy chủ thật sự bật Sandbox (mặc định tắt – các nút sẽ báo 403)
  fetch((window.Pay && Pay.getApiBase ? Pay.getApiBase() : '/api/') + 'health', { cache: 'no-store' })
    .then(r => r.json()).then(h => { if (!h || h.sandbox !== true) { const sb = document.getElementById('sandbox-details'); if (sb) sb.remove(); } })
    .catch(() => { const sb = document.getElementById('sandbox-details'); if (sb) sb.remove(); });
}
if (params.get('sandbox') === '1' || params.get('test') === '1') {
  const sbEl = document.getElementById('sandbox-details');
  if (sbEl) sbEl.open = true;
}

function copyText(str) {
  navigator.clipboard.writeText(str);
  alert('Đã sao chép: ' + str);
}
function copyTransferContent() { copyText(orderCode); }
const fmt = (sec) => String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');

function setRadar(html, bg, color) {
  const radar = document.querySelector('.pulse-radar');
  if (!radar) return;
  if (bg) { radar.style.background = bg; radar.style.color = color; }
  radar.innerHTML = html;
}

function updateQrCode(amount) {
  const qrImg = document.querySelector('.qr-frame img');
  const src = `https://qr.sepay.vn/img?acc=96886693088500&bank=MSB&amount=${amount}&des=${encodeURIComponent(orderCode)}`;
  if (!qrImg || !(amount > 0)) return;
  if (qrImg.getAttribute('src') !== src) {
    qrImg.onload = () => { qrImg.style.visibility = 'visible'; const l = document.getElementById('qr-loading'); if (l) l.remove(); };
    qrImg.onerror = () => { const l = document.getElementById('qr-loading'); if (l) l.textContent = 'Không tải được mã QR – vui lòng chuyển khoản theo số tài khoản và nội dung bên dưới.'; };
    qrImg.src = src;
  }
}

function go(url, delay = 900) {
  if (hasRedirected) return;
  hasRedirected = true;
  setTimeout(() => { location.href = url; }, delay);
}

// BR-10: nút báo lỗi chỉ mở sau 2 phút (đúng mốc hết thời gian chờ Webhook)
function unlockReportButton() {
  if (isReportUnlocked || isReportSubmitted || hasRedirected) return;
  isReportUnlocked = true;
  const btn = document.getElementById('btn-report-error');
  if (btn) {
    btn.disabled = false;
    Object.assign(btn.style, { opacity: '1', cursor: 'pointer', background: '#ffffff', borderColor: '#dc2626', color: '#dc2626', boxShadow: '0 2px 8px rgba(220, 38, 38, 0.12)' });
  }
  document.getElementById('btn-report-icon').innerHTML = '<i class=ph-megaphone aria-hidden=true></i>';
  document.getElementById('btn-report-text').innerHTML = 'Báo Cáo Lỗi: Tôi đã chuyển tiền nhưng chưa có vé';
  document.getElementById('report-countdown-hint').innerHTML = '<span style="color: #16a34a; font-weight: 700;">● Có thể gửi báo cáo ngay</span>';
}
window.unlockReportButton = unlockReportButton;

async function handleReportError() {
  if (!isReportUnlocked || isReportSubmitted) return;
  isReportSubmitted = true;
  const btn = document.getElementById('btn-report-error');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.55'; btn.style.cursor = 'not-allowed'; }
  document.getElementById('btn-report-icon').innerHTML = '<i class=ph-hourglass-medium aria-hidden=true></i>';
  document.getElementById('btn-report-text').innerHTML = 'Đang gửi báo cáo và tra cứu cổng thanh toán...';
  const statusText = document.getElementById('report-error-status');
  try {
    const r = await Pay.reportIssue(orderCode);
    statusText.style.display = 'block';
    statusText.innerHTML = `<i class=ph-check aria-hidden=true></i> Đã tạo phiếu hỗ trợ <strong>#${r.ticket_code}</strong> kèm đầy đủ thông tin đơn – bạn không cần cung cấp lại. Đang chuyển sang màn hình xác minh giao dịch...`;
    go('verify.html?order=' + encodeURIComponent(orderCode), 1200);
  } catch (e) {
    isReportSubmitted = false;
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    document.getElementById('btn-report-icon').innerHTML = '<i class=ph-megaphone aria-hidden=true></i>';
    document.getElementById('btn-report-text').innerHTML = 'Báo Cáo Lỗi: Tôi đã chuyển tiền nhưng chưa có vé';
    alert('Chưa gửi được báo cáo: ' + e.message + '. Vui lòng thử lại hoặc gửi yêu cầu ở Trung tâm hỗ trợ.');
  }
}
window.handleReportError = handleReportError;

// Cổng ví / thẻ: máy chủ tạo phiên thanh toán và trả địa chỉ trang của cổng
async function loadAltPay() {
  try {
    if (new URLSearchParams(location.search).get('pay') === 'failed') document.getElementById('alt-pay-msg').textContent = 'Giao dịch qua ví / thẻ chưa thành công. Bạn có thể thử lại hoặc chuyển khoản VietQR.';
    const methods = ((await Pay.call('pay?action=methods')).methods || []).filter(m => m.id !== 'VIETQR');
    if (!methods.length) return;
    const box = document.getElementById('alt-pay');
    box.hidden = false;
    document.getElementById('alt-pay-list').innerHTML = methods.map(m => '<button type="button" class="btn btn-outline" data-p="' + m.id + '" style="width: 100%; justify-content: center;">' + m.label.replace(/[<>&]/g, '') + '</button>').join('');
    box.querySelectorAll('button[data-p]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      document.getElementById('alt-pay-msg').textContent = '';
      try {
        const r = await Pay.post('pay?action=start', { order_code: orderCode, provider: b.dataset.p });
        location.href = r.pay_url;
      } catch (e) { document.getElementById('alt-pay-msg').textContent = e.message; b.disabled = false; }
    });
  } catch (e) { /* không lấy được danh sách cổng: vẫn thanh toán VietQR bình thường */ }
}

function render(o) {
  const alt = document.getElementById('alt-pay');
  if (alt && o && o.status !== 'PENDING') alt.hidden = true;
  order = o;
  if (hasRedirected) return;
  document.getElementById('transfer-content').textContent = o.code;
  document.getElementById('note-order-code').textContent = o.code;
  const need = o.status === 'PENDING' ? o.remaining_amount : o.total;
  document.getElementById('payment-total-amount').textContent = Pay.vnd(need);
  updateQrCode(need);
  secondsLeft = o.seconds_left;
  document.getElementById('gateway-countdown').textContent = fmt(secondsLeft);

  if (o.status === 'PENDING') {
    if (o.paid_amount > 0) {
      setRadar(`<i class=ph-warning aria-hidden=true></i> <span>Đã nhận <strong>${Pay.vnd(o.paid_amount)}</strong>, còn thiếu <strong>${Pay.vnd(o.remaining_amount)}</strong>. Đang chuyển sang trang chuyển bù...</span>`, '#fef3c7', '#b45309');
      return go('underpay.html?order=' + o.code, 1200);
    }
    // BR-07: hiển thị trạng thái rà soát ngầm của Tầng 1
    setRadar(`<div class="radar-dot"></div><span><strong>${o.status_label}</strong> · ${o.status_sublabel}</span>`);
    if (o.seconds_since_created >= 120) unlockReportButton();
    return;
  }
  if (o.has_ticket) {
    setRadar(`<i class=ph-check aria-hidden=true></i> <span>${o.status === 'CONFIRMED_LATE' ? 'Đối soát thành công – đã cấp vé bù' : 'Thanh toán thành công – đang xuất vé điện tử'}...</span>`, '#d1fae5', '#065f46');
    return go(Pay.routeFor(o));
  }
  // EXPIRED / CANCELLED / REFUND_REQUESTED / REFUNDED / MANUAL_REVIEW
  setRadar(`<i class=ph-info aria-hidden=true></i> <span>${o.status_label}. Đang chuyển sang trang theo dõi đơn...</span>`, '#e0f2fe', '#075985');
  go('order.html?code=' + o.code, 1500);
}

// Đồng hồ chạy từng giây ở trình duyệt, được hiệu chỉnh lại theo máy chủ mỗi lần cập nhật
setInterval(() => {
  if (hasRedirected || !order || order.status !== 'PENDING') return;
  secondsLeft = Math.max(0, secondsLeft - 1);
  document.getElementById('gateway-countdown').textContent = fmt(secondsLeft);
  const sinceStart = order.seconds_since_created + (order.seconds_left - secondsLeft);
  const unlockIn = Math.max(0, 120 - sinceStart);
  if (!isReportUnlocked) {
    document.getElementById('btn-report-timer').textContent = fmt(unlockIn);
    document.getElementById('report-unlock-time').textContent = fmt(unlockIn);
    if (unlockIn === 0) unlockReportButton();
  }
}, 1000);

async function triggerSimulation(scenario, extra = {}) {
  const out = document.getElementById('sandbox-result');
  try {
    const r = await Pay.simulate(scenario, orderCode, null, extra);
    out.textContent = '✓ ' + r.description;
    if (r.order) render(r.order);
  } catch (e) {
    out.textContent = '✗ ' + e.message;
  }
}
window.triggerSimulation = triggerSimulation;

if (!orderCode) {
  setRadar('<i class=ph-warning aria-hidden=true></i> <span>Thiếu mã đơn hàng. Vui lòng đặt vé lại từ bước chọn ghế.</span>', '#fee2e2', '#991b1b');
} else {
  Pay.watch(orderCode, render, 3000);
  loadAltPay();
}
// Nút hủy đơn (data-on-click="cancelThisOrder(this)"): mã đơn lấy từ ?order=
function cancelThisOrder(btn) { Pay.confirmCancel(new URLSearchParams(location.search).get('order'), btn); }
