// js/invoice.js - mã của invoice.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Tải PDF: dùng hộp thoại in của trình duyệt ("Lưu dưới dạng PDF"); tên file mặc định = mã đơn
function downloadInvoicePdf() {
  const code = (new URLSearchParams(location.search).get('order') || new URLSearchParams(location.search).get('code') || '').replace(/[^\w-]/g, '');
  const oldTitle = document.title;
  document.title = 'hoa-don-beta-' + (code || 've');
  if (!sessionStorage.getItem('pdf_hint_shown')) {
    try { sessionStorage.setItem('pdf_hint_shown', '1'); } catch (e) {}
    alert('Trong hộp thoại in, chọn máy in "Lưu dưới dạng PDF" (Save as PDF) để tải hóa đơn về máy.');
  }
  const restore = () => { document.title = oldTitle; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
window.downloadInvoicePdf = downloadInvoicePdf;

// Hóa đơn dựng từ đơn hàng thật trên máy chủ (không còn dữ liệu mẫu)
const VAT_RATE = 0.08;
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v == null ? '' : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BADGES = {
  paid: '<span class="badge" style="background: #d1fae5; color: #065f46; font-weight: 800; font-size: 12px;"><i class=ph-check aria-hidden=true></i> ĐÃ THANH TOÁN</span>',
  refunding: '<span class="badge" style="background: #dbeafe; color: #1e40af; font-weight: 800; font-size: 12px;"><i class=ph-hourglass-medium aria-hidden=true></i> ĐANG XỬ LÝ HOÀN TIỀN</span>',
  refunded: '<span class="badge" style="background: #e0e7ff; color: #3730a3; font-weight: 800; font-size: 12px;"><i class=ph-check aria-hidden=true></i> ĐÃ HOÀN TIỀN</span>',
  pending: '<span class="badge" style="background: #fef3c7; color: #92400e; font-weight: 800; font-size: 12px;"><i class=ph-hourglass-medium aria-hidden=true></i> CHỜ THANH TOÁN</span>',
  cancelled: '<span class="badge" style="background: #f1f5f9; color: #475569; font-weight: 800; font-size: 12px;"><i class=ph-x aria-hidden=true></i> ĐÃ HỦY</span>'
};

function showError(msg) {
  const main = document.querySelector('main');
  main.innerHTML = `<div style="max-width: 560px; margin: 60px auto; text-align: center; padding: 32px; background: #fff; border-radius: 16px; border: 1px solid #e2e8f0;">
        <div style="font-size: 40px;"><i class=ph-receipt aria-hidden=true></i></div>
        <h2 style="margin: 12px 0 8px; color: #0f172a;">Không mở được hóa đơn</h2>
        <p style="color: #64748b; margin-bottom: 20px;">${esc(msg)}</p>
        <a href="account.html" class="btn btn-primary">Về lịch sử đơn hàng</a>
      </div>`;
}

async function loadInvoiceDetails() {
  const code = (new URLSearchParams(location.search).get('order') || '').trim().toUpperCase();
  if (!code) return showError('Thiếu mã đơn hàng.');
  let o;
  try {
    o = await Pay.call('order-status?code=' + encodeURIComponent(code));
  } catch (e) {
    return showError(e.status === 404 ? 'Không tìm thấy đơn hàng #' + code + '.' : 'Lỗi kết nối máy chủ: ' + e.message);
  }

  const m = Pay.getMovie(o.movie_key);
  const created = new Date(o.created_at);
  const state = o.has_ticket ? 'paid'
    : o.status === 'REFUNDED' ? 'refunded'
    : ['EXPIRED', 'REFUND_REQUESTED', 'MANUAL_REVIEW'].includes(o.status) ? 'refunding'
    : o.status === 'PENDING' ? 'pending' : 'cancelled';

  setText('page-inv-code', o.code);
  setText('page-inv-number', 'HD-' + created.getFullYear() + '-' + o.code.slice(-6));
  setText('page-inv-symbol', '1C' + String(created.getFullYear()).slice(-2) + 'TBB');
  setText('page-inv-created-at', created.toLocaleString('vi-VN'));
  document.getElementById('page-inv-status-badge').innerHTML = BADGES[state];

  setText('page-inv-customer-name', o.customer_name || '—');
  setText('page-inv-customer-phone', o.phone || '—');
  setText('page-inv-customer-email', o.email || '—');
  setText('page-inv-member-id', o.customer_name ? 'Thành viên Beta Club' : 'Khách lẻ');

  setText('page-inv-movie-title', m.title);
  document.getElementById('page-inv-movie-poster').src = m.poster;
  setText('page-inv-cinema', o.cinema);
  setText('page-inv-room', 'Phòng chiếu 01');
  setText('page-inv-showtime', (o.show_time || '') + ' • ' + (o.show_date || ''));
  setText('page-inv-seats', (o.seats || []).join(', '));
  setText('page-inv-format', m.format);

  // Bảng kê: giá ghế lấy đúng số đã lưu khi tạo đơn (giá theo khung giờ + loại vé); combo theo catalog.js
  let q = null;
  const pr = await Pay.pricing();
  const T = (pr && pr.ticket_types) || BetaCatalog.TICKET_TYPES;
  const sp = o.seat_prices || {};
  let items;
  if (Object.keys(sp).length) {
    const groups = {};
    (o.seats || []).forEach(id => {
      const seatT = BetaCatalog.seatType(id);
      const tt = (o.ticket_types || {})[id];
      const label = BetaCatalog.SEAT_LABEL[seatT] + (tt && tt !== 'ADULT' && tt !== 'COUPLE' ? ' – vé ' + ((T[tt] || {}).label || tt) : '');
      const key = label + '|' + sp[id];
      (groups[key] = groups[key] || { label, price: Number(sp[id]) || 0, ids: [] }).ids.push(id);
    });
    const combos = Object.entries(o.combos || {}).filter(([k, n]) => BetaCatalog.COMBOS[k] && n > 0)
      .map(([k, n]) => ({ name: BetaCatalog.COMBOS[k].name, qty: n, price: BetaCatalog.COMBOS[k].price, amount: n * BetaCatalog.COMBOS[k].price }));
    items = [
      ...Object.values(groups).map(g => ({ name: g.label + ' (' + g.ids.join(', ') + ')', qty: g.ids.length, price: g.price, amount: g.price * g.ids.length })),
      ...combos
    ];
    const gross = items.reduce((s, it) => s + it.amount, 0);
    q = { discount: Math.max(0, gross - o.total) };
  } else {
    try { q = BetaCatalog.quote({ seats: o.seats, combos: o.combos, voucher: o.voucher }); } catch (e) {}
  }
  items = items || (q
    ? [
        ...Object.entries(q.seats.reduce((acc, s) => { (acc[s.type] = acc[s.type] || []).push(s); return acc; }, {}))
          .map(([type, list]) => ({ name: BetaCatalog.SEAT_LABEL[type] + ' (' + list.map(s => s.id).join(', ') + ')', qty: list.length, price: list[0].price, amount: list.length * list[0].price })),
        ...q.combos.map(c => ({ name: c.name, qty: c.qty, price: c.price, amount: c.amount }))
      ]
    : [{ name: 'Vé xem phim (' + (o.seats || []).join(', ') + ')', qty: (o.seats || []).length || 1, price: o.total, amount: o.total }]);
  const discount = q ? q.discount : 0;

  const tbody = document.getElementById('page-inv-items-body');
  tbody.innerHTML = items.map((it, i) => `<tr>
          <td><strong>${i + 1}. ${esc(it.name)}</strong></td>
          <td style="text-align: center;">${it.qty}</td>
          <td style="text-align: right;">${vnd(it.price)}</td>
          <td style="text-align: right; font-weight: 700;">${vnd(it.amount)}</td>
        </tr>`).join('');

  const subtotal = Math.round(o.total / (1 + VAT_RATE));
  setText('page-inv-subtotal', vnd(subtotal));
  setText('page-inv-vat', vnd(o.total - subtotal));
  setText('page-inv-discount', discount ? '-' + vnd(discount) + (o.voucher ? ' (' + o.voucher + ')' : '') : '0 đ');
  setText('page-inv-total', vnd(o.total));

  setText('page-inv-payment-method', 'Chuyển khoản VietQR (SePay)');
  setText('page-inv-bank-code', o.paid_at ? 'Đã nhận ' + vnd(o.paid_amount) + ' lúc ' + new Date(o.paid_at).toLocaleString('vi-VN') : 'Chưa ghi nhận giao dịch');
  document.getElementById('page-inv-status-note').innerHTML = '<strong>Ghi chú:</strong> ' + esc(o.status_label + (o.status_sublabel ? ' – ' + o.status_sublabel : ''));
  setText('page-inv-barcode-text', o.code);

  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? (el.tagName === 'A' ? 'inline-flex' : 'block') : 'none'; };
  show('page-inv-barcode-section', state === 'paid');
  show('page-inv-view-ticket-btn', state === 'paid');
  show('page-inv-refund-steps-section', state === 'refunding');
  show('page-inv-report-issue-btn', state === 'pending');
  const tk = document.getElementById('page-inv-view-ticket-btn');
  if (tk) tk.href = 'ticket.html?order=' + encodeURIComponent(o.code);
  const rb = document.getElementById('page-inv-report-issue-btn');
  if (rb) rb.onclick = (e) => { e.preventDefault(); location.href = 'betabot.html?order=' + encodeURIComponent(o.code); };
  if (o.refund) setText('page-inv-refund-ref-code', o.refund.code);
}

loadInvoiceDetails();
