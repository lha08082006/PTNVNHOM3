// js/order.js - mã của order.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Trang "Theo dõi đơn hàng" (US-03 / REQ-03): nhãn trạng thái thực tế theo vòng đời đơn,
// thanh tiến trình hoàn tiền 4 mốc (BR-08), lịch sử xử lý và thông báo đã gửi.
const params = new URLSearchParams(location.search);
const code = (params.get('code') || params.get('order') || '').toUpperCase();
const root = document.getElementById('od-root');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EXPLAIN = {
  PENDING: 'Đơn đang trong 10 phút giữ ghế. Hệ thống tự kiểm tra với cổng thanh toán, bạn không cần thao tác thêm sau khi chuyển khoản.',
  EXPIRED: 'Đơn đã hết giờ giữ ghế và ghế đã được nhả, nhưng hệ thống vẫn tự đối soát với ngân hàng 30 phút/lần trong 24 giờ. Nếu tiền đã bị trừ: còn ghế và còn ít nhất 30 phút trước giờ chiếu thì bạn được cấp vé bù, nếu không thì được hoàn tiền tự động.',
  CONFIRMED: 'Thanh toán đã được xác nhận và vé điện tử đã được xuất.',
  CONFIRMED_LATE: 'Giao dịch được ghi nhận trễ nhưng tiền vào trước hạn giữ ghế và ghế vẫn còn trống, nên hệ thống đã cấp vé bù cho bạn.',
  REFUND_REQUESTED: 'Không thể cấp vé cho đơn này nên hệ thống đang tự gửi lệnh hoàn tiền về tài khoản bạn đã dùng để chuyển khoản (tối đa 24 giờ). Bạn không cần điền form hay gọi CSKH.',
  REFUNDED: 'Lệnh hoàn tiền đã được gửi. Thời gian tiền về tài khoản tùy ngân hàng (thường 3–7 ngày làm việc).',
  MANUAL_REVIEW: 'Hệ thống chưa thể tự hoàn tiền cho đơn này. Vui lòng điền biểu mẫu nhận hoàn tiền để CSKH đối chiếu và chuyển Kế toán hoàn tiền thủ công (3–7 ngày làm việc).',
  CANCELLED: 'Đơn đã hủy và không ghi nhận giao dịch nào. Nếu bạn chắc chắn đã bị trừ tiền, hãy bấm "Báo lỗi" để CSKH kiểm tra sao kê.',
  FAILED: 'Cổng thanh toán báo giao dịch thất bại, bạn không bị trừ tiền.'
};
const REFUND_STATUS = {
  REQUESTED: 'Đã tạo yêu cầu, đang gửi lệnh hoàn', RETRYING: 'Cổng hoàn tiền chưa phản hồi – hệ thống tự gửi lại mỗi 30 phút',
  DONE: 'Đã chuyển hoàn', MANUAL_REVIEW: 'Chờ bạn điền biểu mẫu nhận hoàn tiền', FORM_SUBMITTED: 'CSKH đang đối chiếu biểu mẫu',
  CS_APPROVED: 'CSKH đã duyệt – chờ Kế toán chi hoàn', PAID_OUT: 'Kế toán đã chi – chờ xác nhận hoàn tất'
};

function refundBlock(r) {
  const activeIdx = r.steps.findIndex(s => !s.done);
  const steps = r.steps.map((s, i) => `
        <div class="step ${s.done ? 'done' : i === activeIdx ? 'active' : ''}">
          <div class="dot">${s.done ? '<i class=ph-check aria-hidden=true></i>' : i + 1}</div>${esc(s.label)}
          <small>${s.at ? Pay.fmtTime(s.at) : ''}</small>
        </div>`).join('');
  const form = r.needs_form ? `
        <div class="callout tone-danger">
          <strong>Cần bạn bổ sung thông tin.</strong> ${r.cs_note ? 'CSKH ghi chú: ' + esc(r.cs_note) + '. ' : ''}Vui lòng điền ngân hàng thụ hưởng, số tài khoản, tên chủ tài khoản và ảnh biên lai chuyển khoản.
          <div class="actions"><a class="btn btn-primary btn-sm" href="refund.html?order=${encodeURIComponent(code)}">Điền biểu mẫu nhận hoàn tiền →</a></div>
        </div>` : '';
  return `
        <div style="margin-top: 6px;">
          <div class="row"><span>Mã hồ sơ</span><strong style="font-family: monospace;">${esc(r.code)}</strong></div>
          <div class="row"><span>Số tiền hoàn</span><strong style="color: #c2410c;">${Pay.vnd(r.amount)}</strong></div>
          <div class="row"><span>Lý do</span><span>${esc(r.reason_label)}</span></div>
          <div class="row"><span>Tình trạng</span><span>${esc(REFUND_STATUS[r.status] || r.status)}${r.is_manual ? ' · hoàn thủ công' : ' · tự động'}</span></div>
          ${r.source_account ? `<div class="row"><span>Hoàn về</span><span>${esc(r.source_account.bank_name || '')} ${esc(r.source_account.acc_masked)}</span></div>` : ''}
          ${r.refund_ref ? `<div class="row"><span>Mã giao dịch hoàn</span><strong style="font-family: monospace;">${esc(r.refund_ref)}</strong></div>` : ''}
          ${r.status !== 'DONE' && !r.is_manual ? `<div class="row"><span>Hạn gửi lệnh hoàn</span><span>${Pay.fmtTime(r.deadline_at)}</span></div>` : ''}
          <div class="steps">${steps}</div>
          ${form}
        </div>`;
}

function render(o) {
  const m = Pay.movieOf(o);
  const tone = Pay.statusTone(o.status);
  const refunds = o.refunds || [];
  const reported = o.tickets && o.tickets.some(t => t.type === 'PAYMENT_REPORT');
  const canReport = ['PENDING', 'EXPIRED', 'CANCELLED'].includes(o.status) && !reported;
  const history = (o.history || []).slice().reverse();

  root.innerHTML = `
        <div class="od-card od-head">
          <img loading="lazy" decoding="async" src="${esc(m.poster)}" alt="">
          <div class="meta">
            <div style="font-size: 12px; color: #64748b; font-weight: 700;">ĐƠN HÀNG <span style="font-family: monospace; color: #0f172a;">#${esc(o.code)}</span></div>
            <h1>${esc(m.shortTitle || m.title)} <span style="font-size: 13px; color: #c2410c;">${esc(m.age || '')}</span></h1>
            <div style="font-size: 13.5px; color: #475569;">${esc(Pay.slotText(o))}</div>
          </div>
          <div style="text-align: right;">
            <span class="badge tone-${tone}">● ${esc(o.status_label)}</span>
            ${o.status_sublabel ? `<div style="font-size: 12px; color: #64748b; margin-top: 6px; max-width: 260px;">${esc(o.status_sublabel)}</div>` : ''}
          </div>
        </div>

        <div>
          <div class="od-card">
            <h2>Tình trạng giao dịch</h2>
            <div class="callout tone-${tone}" style="margin-top: 0;">${esc(EXPLAIN[o.status] || '')}</div>
            <div style="margin-top: 12px;">
              <div class="row"><span>Giá trị đơn</span><strong>${Pay.vnd(o.total)}</strong></div>
              <div class="row"><span>Đã nhận</span><strong>${Pay.vnd(o.paid_amount)}</strong></div>
              ${o.paid_at ? `<div class="row"><span>Thời điểm giao dịch ngân hàng</span><span>${Pay.fmtTime(o.paid_at)}</span></div>` : ''}
              <div class="row"><span>Hết hạn giữ ghế</span><span>${Pay.fmtTime(o.hold_expires_at)}</span></div>
              ${o.scan_until && o.status === 'EXPIRED' ? `<div class="row"><span>Đối soát tự động đến</span><span>${Pay.fmtTime(o.scan_until)}</span></div>` : ''}
            </div>
            <div class="actions">
              ${o.has_ticket ? `<a class="btn btn-primary btn-sm" href="ticket.html?order=${encodeURIComponent(o.code)}"><i class=ph-ticket aria-hidden=true></i> Xem vé điện tử</a>` : ''}
              ${o.status === 'PENDING' ? `<a class="btn btn-primary btn-sm" href="${Pay.routeFor(o)}"><i class=ph-device-mobile aria-hidden=true></i> Quay lại màn hình thanh toán</a>` : ''}
              ${o.status === 'PENDING' && !o.paid_amount && window.BetaAuth && BetaAuth.isLoggedIn() ? `<button type="button" class="btn btn-outline btn-sm" data-on-click="Pay.confirmCancel('${esc(o.code)}', this)" style="color: #b91c1c; border-color: #fecaca;"><i class=ph-x aria-hidden=true></i> Hủy đơn & nhả ghế</button>` : ''}
              ${o.has_ticket && window.BetaAuth && BetaAuth.isLoggedIn() ? `<button type="button" class="btn btn-outline btn-sm" data-on-click="Pay.resendTicketUI('${esc(o.code)}', this)"><i class=ph-envelope aria-hidden=true></i> Gửi lại vé qua email</button>` : ''}
              ${canReport ? `<button class="btn btn-outline btn-sm" data-on-click="report()" style="color: #dc2626; border-color: #fca5a5;"><i class=ph-megaphone aria-hidden=true></i> Báo lỗi: đã chuyển tiền nhưng chưa có vé</button>` : ''}
              <a class="btn btn-outline btn-sm" href="betabot.html?order=${encodeURIComponent(o.code)}"><i class=ph-robot aria-hidden=true></i> Chat BetaBot hỗ trợ đối soát</a>
            </div>
            ${reported ? `<div style="font-size: 12.5px; color: #475569; margin-top: 8px;"><i class=ph-check aria-hidden=true></i> Đã gửi phiếu hỗ trợ #${esc(o.tickets.find(t => t.type === 'PAYMENT_REPORT').code)} – CSKH đã có đủ thông tin đơn.</div>` : ''}
          </div>

          ${refunds.length ? `<div class="od-card" style="margin-top: 18px;"><h2>Tiến trình hoàn tiền</h2>${refunds.map(refundBlock).join('<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;">')}</div>` : ''}
        </div>

        <div>
          <div class="od-card">
            <h2>Thông báo đã gửi</h2>
            ${(o.notifications || []).length ? o.notifications.map(n => `<div class="note"><b>${esc(n.title)}</b>${esc(n.message)}<div style="color: #64748b; font-size: 12px; margin-top: 4px;">${Pay.fmtTime(n.at)} · ${(n.channels || []).filter(c => c !== 'SMS').map(c => ({ WEB: 'Website', EMAIL: 'Email' })[c] || c).join(', ')}</div></div>`).join('') : '<div style="color: #94a3b8; font-size: 13px;">Chưa có thông báo.</div>'}
          </div>
          <div class="od-card" style="margin-top: 18px;">
            <h2>Lịch sử xử lý</h2>
            <ul class="tl">${history.map(h => `<li>${esc(h.note || h.to)}<time>${Pay.fmtTime(h.at)}</time></li>`).join('')}</ul>
          </div>
        </div>`;
}

// Hóa đơn điện tử: chủ đơn đã thanh toán gửi thông tin xuất hóa đơn trong thời hạn cho phép
async function loadInvoice(o) {
  if (!o || !o.has_ticket || o.limited || !(window.BetaAuth && BetaAuth.isLoggedIn())) return;
  let r;
  try { r = await Pay.call('invoice?code=' + encodeURIComponent(o.code)); } catch (e) { return; }
  const wrap = document.getElementById('inv-wrap'), card = document.getElementById('inv-card');
  const q = r.request;
  if (!q && !r.can_request) return;
  wrap.hidden = false;
  const v = (k) => esc(q && q[k] ? q[k] : '');
  const info = q ? `<div class="row"><span>Trạng thái</span><strong>${esc(q.status_label)}</strong></div>
        ${q.invoice_no ? `<div class="row"><span>Số hóa đơn</span><strong>${esc(q.invoice_no)}${q.invoice_series ? ' · ' + esc(q.invoice_series) : ''}</strong></div>` : ''}
        ${q.lookup_url ? `<div class="row"><span>Tra cứu</span><a href="${esc(q.lookup_url)}" target="_blank" rel="noopener">Mở hóa đơn ↗</a></div>` : ''}` : '';
  card.innerHTML = `<h2>Hóa đơn điện tử</h2>${info}${r.can_request ? `
        <p style="font-size: 13px; color: #475569; margin: 6px 0 12px;">Gửi thông tin trước ${Pay.fmtTime(r.deadline)} (trong ${r.hours} giờ sau khi thanh toán). Hóa đơn gửi về email bạn nhập.</p>
        <form id="inv-form" style="display: grid; gap: 10px;">
          <div role="radiogroup" aria-label="Loại người mua" style="display: flex; gap: 16px; font-size: 14px;">
            <label><input type="radio" name="bt" value="COMPANY" ${!q || q.buyer_type === 'COMPANY' ? 'checked' : ''}> Công ty</label>
            <label><input type="radio" name="bt" value="PERSONAL" ${q && q.buyer_type === 'PERSONAL' ? 'checked' : ''}> Cá nhân</label>
          </div>
          <div class="inv-co" style="display: grid; gap: 10px;">
            <input class="form-input" name="tax_code" placeholder="Mã số thuế (10 số hoặc 10 số-3 số)" value="${v('tax_code')}" aria-label="Mã số thuế" inputmode="numeric">
            <input class="form-input" name="company_name" placeholder="Tên công ty theo đăng ký thuế" value="${v('company_name')}" aria-label="Tên công ty">
            <input class="form-input" name="address" placeholder="Địa chỉ công ty" value="${v('address')}" aria-label="Địa chỉ công ty">
          </div>
          <input class="form-input" name="buyer_name" placeholder="Họ tên người mua" value="${v('buyer_name')}" aria-label="Họ tên người mua">
          <input class="form-input" type="email" name="email" placeholder="Email nhận hóa đơn" value="${v('email') || esc(o.email || '')}" aria-label="Email nhận hóa đơn" required>
          <p id="inv-msg" role="status" style="font-size: 13px; margin: 0;"></p>
          <button class="btn btn-primary btn-sm" type="submit">${q ? 'Cập nhật thông tin' : 'Gửi yêu cầu xuất hóa đơn'}</button>
        </form>` : ''}`;
  const f = document.getElementById('inv-form');
  if (!f) return;
  const sync = () => { f.querySelector('.inv-co').style.display = f.bt.value === 'COMPANY' ? 'grid' : 'none'; };
  f.querySelectorAll('input[name=bt]').forEach(i => i.onchange = sync);
  sync();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const m = document.getElementById('inv-msg');
    try {
      await Pay.post('invoice', { order_code: o.code, buyer_type: f.bt.value, tax_code: f.tax_code.value, company_name: f.company_name.value, address: f.address.value, buyer_name: f.buyer_name.value, email: f.email.value });
      await loadInvoice(o);
      const m2 = document.getElementById('inv-msg');
      if (m2) { m2.style.color = '#15803d'; m2.textContent = '✓ Đã gửi yêu cầu. Kế toán sẽ xuất hóa đơn và gửi về email của bạn.'; }
    } catch (err) { m.style.color = '#b91c1c'; m.textContent = err.message; }
  };
}

async function report() {
  try {
    const r = await Pay.reportIssue(code);
    alert('Đã tạo phiếu hỗ trợ #' + r.ticket_code + '. Hệ thống đã tra cứu lại cổng thanh toán ngay và CSKH đã có đủ thông tin đơn của bạn.');
    render(r);
  } catch (e) {
    alert('Chưa gửi được: ' + e.message);
  }
}

function showSearch(msg) {
  root.innerHTML = `<div class="od-card od-empty">
        <h2 style="text-transform: none;">${esc(msg)}</h2>
        <div class="od-search"><input aria-label="BCxxxxxxxxxx" id="od-code" placeholder="BCxxxxxxxxxx" value="${esc(code)}"><button class="btn btn-primary" data-on-click="goToOrderCode()">Tra cứu</button></div>
      </div>`;
}

if (!code) {
  showSearch('Nhập mã đơn hàng để theo dõi trạng thái giao dịch');
} else {
  let loaded = false;
  Pay.call('order-status?code=' + encodeURIComponent(code))
    .then(o => { loaded = true; render(o); loadInvoice(o); })
    .catch(e => showSearch(e.status === 404 ? 'Không tìm thấy đơn #' + code : 'Không tải được đơn hàng: ' + e.message));
  // Cập nhật thời gian thực (mỗi lần hỏi cũng đẩy Job đối soát cho đơn này)
  setInterval(() => {
    if (!loaded || document.hidden) return;
    Pay.call('order-status?code=' + encodeURIComponent(code)).then(render).catch(() => {});
  }, 10000);
}
// Ô "Tra cứu đơn khác" (data-on-click="goToOrderCode()")
function goToOrderCode() { location.href = 'order.html?code=' + document.getElementById('od-code').value.trim(); }
