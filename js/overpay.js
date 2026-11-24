// js/overpay.js - mã của overpay.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Chuyển thừa: vé vẫn được xuất, phần thừa được TỰ ĐỘNG hoàn về tài khoản đã chuyển (Refund API).
// Khách chỉ phải điền biểu mẫu khi hệ thống không tự hoàn được trong 24 giờ.
const params = new URLSearchParams(window.location.search);
const orderCode = (params.get('order') || '').toUpperCase();
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
const trackUrl = 'order.html?code=' + encodeURIComponent(orderCode);
const ticketBtn = document.getElementById('btn-view-ticket');
if (ticketBtn) ticketBtn.href = 'ticket.html?order=' + encodeURIComponent(orderCode);

const form = document.getElementById('overpay-refund-form');
const box = document.createElement('div');
box.id = 'overpay-auto-refund';
box.style.cssText = 'padding: 14px 16px; border-radius: 12px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; font-size: 13.5px; line-height: 1.6;';
box.textContent = 'Đang tải trạng thái hoàn tiền thừa...';
if (form) { form.style.display = 'none'; form.parentNode.insertBefore(box, form); }

function renderOverpayData(ord) {
  if (!ord) return;
  const ex = (ord.refunds || []).find(r => r.reason === 'EXCESS');
  const excess = ex ? ex.amount : ord.excess_amount;
  document.getElementById('overpay-order-code').textContent = ord.code;
  document.getElementById('overpay-paid-amount').textContent = Pay.vnd(ord.paid_amount);
  document.getElementById('overpay-total-amount').textContent = Pay.vnd(ord.total);
  document.getElementById('overpay-excess-amount').textContent = Pay.vnd(excess);
  if (Pay.renderInvoice) Pay.renderInvoice(ord);

  if (!ex) { box.textContent = 'Chưa ghi nhận khoản chuyển thừa cho đơn này.'; return; }
  const done = ex.status === 'DONE';
  box.innerHTML = done
    ? `<i class=ph-check-circle aria-hidden=true></i> <strong>Đã gửi lệnh hoàn ${Pay.vnd(ex.amount)} tiền thừa</strong> về ${ex.source_account ? (ex.source_account.bank_name + ' ' + ex.source_account.acc_masked) : 'tài khoản đã chuyển'} (mã ${ex.refund_ref || ex.code}). Tiền về tùy ngân hàng, thường 3–7 ngày làm việc.`
    : ex.needs_form
      ? `<i class=ph-warning aria-hidden=true></i> Hệ thống chưa tự hoàn được ${Pay.vnd(ex.amount)} tiền thừa. <a href="refund.html?order=${encodeURIComponent(ord.code)}" style="font-weight: 800;">Điền biểu mẫu nhận hoàn tiền →</a>`
      : `<i class=ph-arrows-clockwise aria-hidden=true></i> Hệ thống đang <strong>tự động hoàn ${Pay.vnd(ex.amount)}</strong> về tài khoản bạn đã chuyển (gửi lại mỗi 30 phút, tối đa 24 giờ). Bạn không cần điền thông tin.`;
  box.innerHTML += ` <a href="${trackUrl}" style="font-weight: 700;">Theo dõi chi tiết →</a>`;
}

if (orderCode) Pay.watch(orderCode, renderOverpayData, 10000);
