// js/refund.js - mã của refund.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// RefundForm (BR-06): chỉ dùng khi đơn ở trạng thái "Chờ xử lý thủ công".
const urlParams = new URLSearchParams(window.location.search);
const orderCode = (urlParams.get('order') || urlParams.get('code') || '').toUpperCase();
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
const MAX_BYTES = 5 * 1024 * 1024;
const trackUrl = 'order.html?code=' + encodeURIComponent(orderCode);
let currentRefund = null;

document.getElementById('btn-back-order').href = trackUrl;
document.getElementById('btn-success-track').href = trackUrl;
document.getElementById('btn-refund-bot').href = 'betabot.html?order=' + encodeURIComponent(orderCode);
document.getElementById('refund-order-code').textContent = orderCode || '—';

function lockForm(message) {
  const form = document.querySelector('form[onsubmit="handleRefundSubmit(event)"]');
  if (!form) return;
  form.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
  const box = document.createElement('div');
  box.style.cssText = 'padding: 12px 14px; border-radius: 10px; background: #eff6ff; color: #1e40af; font-size: 13.5px; line-height: 1.55;';
  box.innerHTML = message + ` <a href="${trackUrl}" style="font-weight: 700;">Xem trạng thái đơn →</a>`;
  form.prepend(box);
}

async function load() {
  if (!orderCode) return lockForm('Thiếu mã đơn hàng.');
  // Chỉ chủ đơn mới khai được tài khoản nhận hoàn tiền
  if (window.BetaAuth) await BetaAuth.requireLogin();
  try {
    const o = await Pay.call('refund?order_code=' + encodeURIComponent(orderCode));
    const m = Pay.getMovie(o.movie_key);
    document.getElementById('refund-movie-title').textContent = m.shortTitle || m.title;
    const rf = (o.refunds || []).find(r => r.needs_form) || o.refund;
    currentRefund = rf;
    document.getElementById('refund-amount-display').textContent = Pay.vnd(rf ? rf.amount : o.paid_amount);
    document.getElementById('refund-tx-time').textContent = o.paid_at ? Pay.fmtTime(o.paid_at) : '—';
    document.getElementById('refund-reason-text').textContent = rf ? rf.reason_label : o.status_label;
    document.getElementById('refund-why-manual').textContent = rf && rf.cs_note
      ? 'CSKH yêu cầu cập nhật: ' + rf.cs_note
      : 'Hệ thống chưa tự hoàn được về tài khoản nguồn (quá hạn 24 giờ hoặc dữ liệu giao dịch cần CSKH đối chiếu).';
    document.getElementById('refund-tx-ref').textContent = rf && rf.tx_refs ? rf.tx_refs.replace(/\+/g, ', ') : '—';
    if (!rf || !rf.needs_form) {
      if (rf && rf.form_submitted) return lockForm('Bạn đã gửi biểu mẫu cho đơn này. CSKH đang đối chiếu và sẽ chuyển Kế toán hoàn tiền.');
      return lockForm('Đơn này <strong>chưa cần điền biểu mẫu</strong>: hệ thống đang tự xử lý (cấp vé bù hoặc tự hoàn tiền về tài khoản đã chuyển trong 24 giờ).');
    }
  } catch (e) {
    lockForm('Không tải được thông tin đơn: ' + e.message);
  }
}

// Kiểm tra JPG/PNG <= 5MB (NFR-12), rồi nén về JPEG <= 1600px để tải lên nhanh trên điện thoại
function readReceipt(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Vui lòng chọn ảnh biên lai chuyển khoản'));
    if (!['image/jpeg', 'image/png'].includes(file.type)) return reject(new Error('Ảnh biên lai phải là JPG hoặc PNG'));
    if (file.size > MAX_BYTES) return reject(new Error('Ảnh biên lai vượt quá 5 MB'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh – tệp có thể bị hỏng')); };
    img.src = url;
  });
}

async function handleRefundSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const bank = document.getElementById('bank-select').value;
  const acc = document.getElementById('acc-number').value.replace(/\s+/g, '');
  const owner = document.getElementById('acc-name').value.trim();
  if (!/^\d{6,20}$/.test(acc)) { alert('Số tài khoản chỉ gồm 6–20 chữ số'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class=ph-hourglass-medium aria-hidden=true></i> Đang gửi biểu mẫu...';
  try {
    const receipt = await readReceipt(document.getElementById('bill-img').files[0]);
    const res = await Pay.submitRefund({ order_code: orderCode, bank_name: bank, acc_number: acc, acc_name: owner, receipt });
    document.getElementById('res-ref-code').textContent = res.refund_code;
    document.getElementById('res-bank-name').textContent = bank;
    document.getElementById('res-bank-acc').textContent = acc;
    document.getElementById('res-bank-owner').textContent = owner.toUpperCase();
    document.getElementById('refund-form-grid').style.display = 'none';
    const ok = document.getElementById('refund-success-container');
    ok.style.display = 'block';
    const amountEl = ok.querySelector('p strong:nth-of-type(2)');
    if (amountEl && currentRefund) amountEl.textContent = Pay.vnd(currentRefund.amount);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = 'Gửi Yêu Cầu Hoàn Tiền';
  }
}
window.handleRefundSubmit = handleRefundSubmit;

load();
