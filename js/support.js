// js/support.js - mã của support.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
function toggleFaq(el) {
  const open = el.classList.toggle('open');
  const q = el.querySelector('.faq-question');
  if (q) q.setAttribute('aria-expanded', open ? 'true' : 'false');
}

const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function lookupOrder() {
  const code = document.getElementById('lookup-input').value.trim().toUpperCase();
  const box = document.getElementById('lookup-result-box');
  if (!code) { alert('Vui lòng nhập mã đơn hàng!'); return; }
  box.style.display = 'block';
  box.style.borderColor = '#cbd5e1';
  box.textContent = 'Đang tra cứu đơn ' + code + '...';
  try {
    const o = await Pay.call('order-status?code=' + encodeURIComponent(code));
    const m = Pay.getMovie(o.movie_key);
    box.style.borderColor = o.has_ticket ? '#047857' : '#f59e0b';
    box.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
            <strong style="font-size: 16px; color: var(--beta-navy);">Đơn hàng: ${esc(o.code)}</strong>
            <span class="badge" style="background: ${o.has_ticket ? '#d1fae5' : '#fef3c7'}; color: ${o.has_ticket ? '#065f46' : '#92400e'};">${esc(o.status_label).toUpperCase()}</span>
          </div>
          <div style="font-size: 13.5px; color: #475569; line-height: 1.6;">
            Phim: <strong>${esc(m.title)}</strong> • Suất chiếu: <strong>${esc(o.show_time)} (${esc(o.show_date)})</strong><br>
            Rạp: <strong>${esc(o.cinema)}</strong> • Ghế: <strong>${esc((o.seats || []).join(', '))}</strong> • Tổng tiền: <strong>${Pay.vnd(o.total)}</strong>
            ${o.status_sublabel ? '<br>' + esc(o.status_sublabel) : ''}
          </div>
          <div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap;">
            ${o.has_ticket ? `<a href="ticket.html?order=${encodeURIComponent(o.code)}" class="btn btn-primary btn-sm">Xem Vé Điện Tử</a>` : ''}
            <a href="order.html?code=${encodeURIComponent(o.code)}" class="btn btn-outline btn-sm">Theo Dõi Đơn Hàng</a>
          </div>`;
    document.getElementById('sp-order').value = o.code;
  } catch (e) {
    box.style.borderColor = '#fca5a5';
    box.textContent = e.status === 404
      ? 'Không tìm thấy đơn hàng ' + code + '. Vui lòng kiểm tra lại mã đơn trong email/SMS xác nhận.'
      : 'Lỗi tra cứu: ' + e.message;
  }
}

async function submitSupport() {
  const val = (id) => document.getElementById(id).value.trim();
  const msg = document.getElementById('sp-msg');
  const btn = document.getElementById('sp-submit');
  btn.disabled = true;
  try {
    const r = await Pay.post('support', {
      category: val('sp-category'), order_code: val('sp-order'), phone: val('sp-phone'),
      amount: val('sp-amount'), description: val('sp-desc')
    });
    msg.style.color = '#15803d';
    msg.textContent = '✓ Đã tiếp nhận yêu cầu. Mã phiếu: ' + r.ticket_code +
      (r.status_label ? ' · Trạng thái đơn: ' + r.status_label : '') +
      '. CSKH sẽ liên hệ qua số điện thoại bạn cung cấp.';
    document.getElementById('sp-desc').value = '';
    loadMyTickets();
  } catch (e) {
    msg.style.color = '#dc2626';
    msg.textContent = e.message;
  } finally {
    msg.style.display = 'block';
    btn.disabled = false;
  }
}

// Phiếu hỗ trợ của tôi (chỉ khi đã đăng nhập): xem phản hồi CSKH và trả lời ngay trên phiếu
async function loadMyTickets() {
  let token = null;
  try { token = localStorage.getItem('BETA_AUTH_TOKEN'); } catch (e) {}
  const box = document.getElementById('my-tickets');
  if (!token) { box.hidden = true; return; }
  const esc2 = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  try {
    const r = await Pay.call('support');
    box.hidden = false;
    document.getElementById('my-tickets-list').innerHTML = r.tickets.length ? r.tickets.map(t => `
          <details style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; background: #fff;" ${t.status === 'WAITING_CUSTOMER' ? 'open' : ''}>
            <summary style="cursor: pointer; font-size: 14px;"><b>${esc2(t.code)}</b> · ${esc2(t.category_label)} · <span style="color: ${t.status === 'RESOLVED' ? '#15803d' : t.status === 'WAITING_CUSTOMER' ? '#b45309' : '#1e40af'}; font-weight: 700;">${esc2(t.status_label)}</span></summary>
            <p style="font-size: 13.5px; color: #475569; margin: 8px 0;">${esc2(t.description)}</p>
            ${t.replies.map(x => `<div style="font-size: 13.5px; margin: 6px 0; padding: 8px 10px; border-radius: 8px; background: ${x.from === 'STAFF' ? '#eff6ff' : '#f8fafc'};"><b>${esc2(x.name)}</b> <span style="color:#64748b; font-size: 12px;">${new Date(x.at).toLocaleString('vi-VN')}</span><br>${esc2(x.message)}</div>`).join('')}
            ${t.status === 'RESOLVED' ? '' : `<form data-on-submit="event.preventDefault(); replyMyTicket('${esc2(t.code)}', this);" style="display: flex; gap: 8px; margin-top: 8px;">
              <input class="form-input" name="m" aria-label="Trả lời CSKH" placeholder="Trả lời CSKH…" required minlength="2" style="flex: 1;">
              <button class="btn btn-outline" type="submit">Gửi</button></form>`}
          </details>`).join('') : '<p style="font-size: 13.5px; color: #64748b;">Bạn chưa gửi phiếu hỗ trợ nào.</p>';
  } catch (e) { box.hidden = true; }
}
async function replyMyTicket(code, form) {
  try { await Pay.post('support?action=reply', { ticket_code: code, message: form.m.value.trim() }); await loadMyTickets(); }
  catch (e) { alert(e.message); }
}
loadMyTickets();

// Mở từ liên kết có sẵn mã đơn: support.html?order=BC...
(function () {
  const code = new URLSearchParams(location.search).get('order');
  if (code) { document.getElementById('lookup-input').value = code; lookupOrder(); }
})();
// Ô tra cứu đơn: Enter = tra cứu (data-on-keydown="lookupOnEnter(event)")
function lookupOnEnter(ev) { if (ev.key === 'Enter') lookupOrder(); }
