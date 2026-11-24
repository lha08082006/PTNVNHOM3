// js/verify.js - mã của verify.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Màn hình xác minh giao dịch: chỉ HIỂN THỊ tiến trình Tầng 1 do máy chủ thực hiện.
// Không tự đẩy khách sang form hoàn tiền – RefundForm chỉ mở khi hệ thống không tự hoàn được (sau 24 giờ).
const params = new URLSearchParams(window.location.search);
const order = (params.get('order') || '').toUpperCase();
let state = null;
let secondsLeft = 0;
let lastUpdate = Date.now();
let redirected = false;

const fmt = (sec) => String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
document.getElementById('btn-verify-back-qr').href = 'gateway.html?order=' + encodeURIComponent(order);
document.getElementById('btn-verify-bot').href = 'betabot.html?order=' + encodeURIComponent(order);
document.getElementById('btn-track-order').href = 'order.html?code=' + encodeURIComponent(order);
document.querySelectorAll('a[href="betabot.html"]').forEach(a => { a.href = 'betabot.html?order=' + encodeURIComponent(order); });

// Lịch Tầng 1 (giây tính từ lúc tạo đơn) – khớp lib/flow.js
const STEPS = [
  { at: 0, end: 120, label: 'Chờ ngân hàng báo kết quả qua Webhook (tối đa 2 phút)' },
  { at: 120, end: 180, label: 'Short Polling: tra cứu nhanh 15 giây/lần (4 lần)' },
  { at: 180, end: 525, label: 'Final Check: kiểm tra định kỳ 3 phút/lần' },
  { at: 600, end: 600, label: 'Tra cứu chốt khi hết 10 phút giữ ghế' }
];

function renderSteps(o) {
  const t = o.seconds_since_created + Math.round((Date.now() - lastUpdate) / 1000);
  document.getElementById('tier1-steps').innerHTML = STEPS.map(s => {
    const done = t >= s.end && !(s.at === 600 && o.status === 'PENDING');
    const active = !done && t >= s.at;
    const icon = done ? '<i class=ph-check-circle aria-hidden=true></i>' : active ? '<i class=ph-arrows-clockwise aria-hidden=true></i>' : '<i class=ph-circle aria-hidden=true></i>';
    return `<li style="list-style: none; margin-left: -18px; color: ${active ? '#005198' : done ? '#16a34a' : '#94a3b8'}; font-weight: ${active ? 700 : 500};">${icon} ${s.label}</li>`;
  }).join('');
  document.getElementById('tier1-now').textContent = o.status_sublabel || '';
  document.getElementById('tier1-leave').style.display = t >= 180 ? 'block' : 'none';
}

function render(o) {
  if (redirected) return;
  state = o;
  lastUpdate = Date.now();
  secondsLeft = o.seconds_left;
  document.getElementById('verify-order-code').textContent = o.code;
  document.getElementById('verify-content').textContent = o.code;
  document.getElementById('verify-amount').textContent = Pay.vnd(o.status === 'PENDING' ? o.remaining_amount : o.total);
  document.getElementById('verify-countdown').textContent = o.status === 'PENDING' ? fmt(secondsLeft) : 'Đã nhả ghế';
  document.querySelector('.verify-card h1').textContent = o.status_label;
  document.getElementById('sec-counter').textContent = '0';
  renderSteps(o);

  const next = o.status === 'PENDING' && o.paid_amount === 0 ? null : Pay.routeFor(o);
  if (next) {
    redirected = true;
    setTimeout(() => { location.href = next; }, 1200);
  }
}

setInterval(() => {
  if (!state || redirected) return;
  const ago = Math.round((Date.now() - lastUpdate) / 1000);
  document.getElementById('sec-counter').textContent = ago;
  if (state.status === 'PENDING') {
    document.getElementById('verify-countdown').textContent = fmt(Math.max(0, secondsLeft - ago));
    renderSteps(state);
  }
}, 1000);

async function triggerSim(sc, extra = {}) {
  const out = document.getElementById('sandbox-result');
  try {
    const r = await Pay.simulate(sc, order, null, extra);
    out.textContent = '✓ ' + r.description;
    if (r.order) render(r.order);
  } catch (e) {
    out.textContent = '✗ ' + e.message;
  }
}
window.triggerSim = triggerSim;

if (order) Pay.watch(order, render, 3000);
else document.querySelector('.verify-card h1').textContent = 'Thiếu mã đơn hàng';
