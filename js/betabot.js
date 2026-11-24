// js/betabot.js - mã của betabot.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
const chatBox = document.getElementById('chat-messages-box');
const inputField = document.getElementById('user-input-box');
    // =========================================================================
// DỮ LIỆU ĐƠN HÀNG CHI TIẾT TỪ TÀI KHOẢN & CSKH
// =========================================================================
// Bộ nhớ đệm các đơn đã tra cứu thật trong phiên chat này
const INVOICES_DATA = {};

let currentActiveOrder = null;

async function resolveOrderInfo(code) {
  if (!code) return null;
  if (INVOICES_DATA[code]) return INVOICES_DATA[code];

  // Tìm trong DB / LocalStorage thông qua Pay client
  try {
    if (window.Pay && Pay.getOrder) {
      const ord = await Pay.getOrder(code);
      if (ord) {
        const movieObj = (Pay.getMovie ? Pay.getMovie(ord.movie_key) : null) || { title: (ord.movie_key || 'Phim Mới').toUpperCase() };
        const seatsStr = Array.isArray(ord.seats) ? ord.seats.join(', ') : (ord.seats || 'Ghế đã chọn');
        const showTimeStr = (ord.show_time || '18:30') + ' • ' + (ord.show_date || 'Hôm nay');

        const resolved = {
          code: ord.code,
          movieTitle: movieObj.title,
          cinema: ord.cinema || '',
          showtime: showTimeStr,
          seats: seatsStr,
          total: ord.total || 0,
          customerName: ord.customer_name || '',
          customerPhone: ord.phone || '',
          date: ord.show_date || 'Hôm nay',
          time: ord.show_time || '18:30',
          statusText: ord.status_label || ''
        };
        INVOICES_DATA[code] = resolved;
        return resolved;
      }
    }
  } catch (e) {
    console.warn('Lỗi tra cứu đơn:', e.message);
  }

  return null;
}
let isDarkMode = false;

// Chuyển đổi giao diện Sáng / Tối
function toggleChatTheme() {
  isDarkMode = !isDarkMode;
  const card = document.getElementById('chat-card-container');
  const btn = document.getElementById('btn-theme-toggle');
  if (isDarkMode) {
    card.classList.add('dark-theme');
    btn.innerHTML = '<i class=ph-sun aria-hidden=true></i> Giao diện Sáng';
  } else {
    card.classList.remove('dark-theme');
    btn.innerHTML = '<i class=ph-moon aria-hidden=true></i> Giao diện Tối';
  }
}

// Scroll to bottom
function scrollToBottom() {
  setTimeout(() => {
    chatBox.scrollTop = chatBox.scrollHeight;
  }, 50);
}

// Handle enter key
function handleInputKey(e) {
  if (e.key === 'Enter') {
    sendMessage();
  }
}

// User sends a message
function sendMessage() {
  const text = inputField.value.trim();
  if (!text) return;

  appendUserMessage(text);
  inputField.value = '';

  // Tự động phân tích câu hỏi
  simulateBotResponse(text);
}

function appendUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  chatBox.appendChild(row);
  scrollToBottom();
}

function appendBotMessage(htmlContent) {
  const row = document.createElement('div');
  row.className = 'msg-row bot';
  row.innerHTML = `
        <img loading="lazy" decoding="async" src="images/betabot-avatar.webp" alt="Bot" class="msg-avatar" data-fallback="images/logo-official.png">
        <div class="bot-bubble">${htmlContent}</div>
      `;
  chatBox.appendChild(row);
  scrollToBottom();
}

// Phân tích tin nhắn gửi từ người dùng
// So khớp ý định không phân biệt dấu / hoa thường: "hoan tien" = "hoàn tiền"
const normVi = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
let awaitingRefundCode = false;
function simulateBotResponse(text) {
  const t = normVi(text);
  const codeHit = /\bBC\d{10}\b/i.exec(text);

  // Hiệu ứng đang gõ
  const typingId = 'typing-' + Date.now();
  const typingRow = document.createElement('div');
  typingRow.id = typingId;
  typingRow.className = 'msg-row bot';
  typingRow.innerHTML = `
        <img loading="lazy" decoding="async" src="images/betabot-avatar.webp" alt="Bot" class="msg-avatar" data-fallback="images/logo-official.png">
        <div class="bot-bubble" style="font-style: italic; color: #64748b;">
          BetaBot đang xử lý dữ liệu...
        </div>
      `;
  chatBox.appendChild(typingRow);
  scrollToBottom();

  setTimeout(() => {
    const el = document.getElementById(typingId);
    if (el) el.remove();

    if (codeHit && (awaitingRefundCode || /hoan tien|refund|tien do/.test(t))) {
      renderRefundTracker(codeHit[0].toUpperCase());
    } else if (/gia ve|bang gia|bao nhieu tien|gia bao nhieu|gia combo|gia bap/.test(t)) {
      appendBotMessage('<p>Bạn xem bảng giá vé theo ngày, khung giờ và giá combo bắp nước tại trang <a href="gia-ve.html">Giá vé &amp; Combo</a>. Giá chính xác của từng suất hiện ngay khi bạn chọn suất chiếu.</p>');
    } else if (/thanh toan|chua co ve|khong co ve|chua nhan ve|doi soat|tru tien/.test(t)) {
      renderReconcileFlow();
    } else if (/hoan tien|refund|tien do/.test(t)) {
      renderRefundTracker();
    } else if (/khieu nai|su co/.test(t)) {
      renderComplaintFlow();
    } else if (/\bve\b|tra cuu/.test(t)) {
      appendBotMessage(`
            <p>Để tra cứu vé nhanh, bạn có thể nhập Mã đơn hàng (BC...) hoặc Số điện thoại mua vé vào ô tra cứu tại trang Hỗ Trợ, hoặc nhấn nút bên dưới:</p>
            <div style="margin-top: 10px;">
              <a href="support.html" class="btn btn-primary btn-sm" style="display:inline-block; font-size:12.5px;">Tra Cứu Vé Tại Support Hub →</a>
            </div>
          `);
    } else {
      appendBotMessage(`
            <p>BetaBot đã nhận thông tin: <em>"${escapeHtml(text)}"</em>.</p>
            <p style="margin-top: 6px;">Tôi có thể giúp bạn giải quyết các vấn đề sau ngay lập tức:</p>
            <div class="chat-chips-group">
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('reconcile')"><i class=ph-lightning aria-hidden=true></i> Đối soát chuyển khoản VietQR</button>
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('refund')"><i class=ph-magnifying-glass aria-hidden=true></i> Kiểm tra hoàn tiền</button>
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('complaint')"><i class=ph-note-pencil aria-hidden=true></i> Khiếu nại sự cố</button>
            </div>
          `);
    }
  }, 700);
}

// Trigger action from chips or sidebar
function triggerQuickAction(action) {
  if (action === 'reconcile') {
    appendUserMessage('Đã thanh toán nhưng không xuất được vé');
    setTimeout(renderReconcileFlow, 400);
  } else if (action === 'refund') {
    appendUserMessage('Kiểm tra trạng thái hoàn tiền');
    setTimeout(renderRefundTracker, 400);
  } else if (action === 'complaint') {
    appendUserMessage('Khiếu nại sự cố chuyển khoản');
    setTimeout(renderComplaintFlow, 400);
  } else if (action === 'find_ticket') {
    appendUserMessage('Tra cứu vé xem phim');
    setTimeout(async () => {
      if (!window.BetaAuth || !BetaAuth.isLoggedIn()) {
        appendBotMessage('Bạn vui lòng <a href="' + BetaAuth.loginUrl() + '">đăng nhập</a> để mình tra cứu vé của bạn nhé.');
        return;
      }
      try {
        const tickets = (await Pay.getOrders({ limit: 20 })).filter(o => o.has_ticket)
          .sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
        if (!tickets.length) { appendBotMessage('Bạn chưa có vé nào đã xuất. Đơn đang chờ thanh toán xem ở mục Tài khoản → Lịch sử đơn hàng.'); return; }
        const o = tickets[0];
        const m = Pay.getMovie(o.movie_key);
        appendBotMessage(`
            <p>Thông tin vé xem phim gần nhất của bạn:</p>
            <div class="form-subcard" style="border-left: 4px solid #047857;">
              <div style="font-weight: 800; color: #005198;">ĐƠN HÀNG #${o.code}</div>
              <div style="font-size: 13px;">Phim: <strong>${m.title}</strong></div>
              <div style="font-size: 13px;">Ghế: <strong>${(o.seats || []).join(', ')}</strong> • Suất: <strong>${o.show_time} (${o.show_date})</strong></div>
              <div style="font-size: 13px; color: #c94200; font-weight: 800;">Tổng tiền: ${Pay.vnd(o.total)} (${o.status_label})</div>
              <a href="ticket.html?order=${encodeURIComponent(o.code)}" class="btn btn-primary btn-sm" style="text-align:center; margin-top: 6px;">Xem Vé Điện Tử (Barcode) →</a>
            </div>`);
      } catch (e) {
        appendBotMessage('Chưa tra cứu được vé: ' + e.message);
      }
    }, 400);
  }
}

// Flow 1: Form Đối Soát Giao Dịch
function renderReconcileFlow() {
  const codeVal = currentActiveOrder ? currentActiveOrder.code : '';
  const amountVal = currentActiveOrder ? new Intl.NumberFormat('vi-VN').format(currentActiveOrder.total) : '';
  const dateVal = currentActiveOrder ? (currentActiveOrder.date || 'Hôm nay') : '';
  const defaultTx = currentActiveOrder ? ('FT' + currentActiveOrder.code.replace(/\D/g, '').slice(-8)) : '';

  appendBotMessage(`
        <p><strong>Nhập thông tin chuyển khoản để đối soát cho đơn <span style="color:#005198; font-family:monospace;">#${codeVal}</span>:</strong></p>
        <div class="form-subcard" id="form-reconcile-box">
          <label class="chat-field">
            Mã giao dịch ngân hàng (Mã FT... / Mã tham chiếu / Ký hiệu chuẩn chi)
            <input type="text" class="chat-input-text" id="recon-txid" value="${defaultTx}" placeholder="VD: FT2610279854">
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <label class="chat-field">
              Số tiền đã trừ (VNĐ)
              <input type="text" class="chat-input-text" id="recon-amount" value="${amountVal}" placeholder="VD: 150.000">
            </label>
            <label class="chat-field">
              Ngày giao dịch
              <input type="text" class="chat-input-text" id="recon-date" value="${dateVal}">
            </label>
          </div>
          <label class="chat-field">
            Mã đặt vé cần đối soát
            <input type="text" class="chat-input-text" id="recon-phone" value="${codeVal}" readonly style="background:#f8fafc; font-weight:700; color:#005198;">
          </label>
          <button class="btn btn-primary btn-sm" data-on-click="submitReconcile()" style="background:#c53030; border:none; padding: 10px; font-weight: 800; border-radius: 8px;">
            Kiểm Tra Đối Soát Cho Đơn #${codeVal} Ngay
          </button>
        </div>
      `);
}

// Submit Đối Soát -> Hiển thị Kết quả đối soát
async function submitReconcile() {
  const txid = (document.getElementById('recon-txid') ? document.getElementById('recon-txid').value : '').trim() || '';
  const amountStr = (document.getElementById('recon-amount') ? document.getElementById('recon-amount').value : '').trim() || '';
  const phone = (document.getElementById('recon-phone') ? document.getElementById('recon-phone').value : '').trim() || ((window.BetaAuth && BetaAuth.cachedUser() || {}).phone || '');

  const urlParams = new URLSearchParams(window.location.search);
  const orderParam = urlParams.get('order') || phone;

  appendUserMessage(`Kiểm tra đối soát mã GD ngân hàng: ${txid}`);

  try {
    const res = await Pay.reconcile({
      order_code: orderParam,
      bank_ref: txid,
      phone: phone,
      amount: parseInt(amountStr.replace(/\D/g, '')) || 179000
    });

    if (res.ok && res.status === 'RECOVERED_PAID') {
      setTimeout(() => {
        appendBotMessage(`
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                <span style="color: #047857; font-size: 20px;"><i class=ph-check aria-hidden=true></i></span>
                <strong style="font-size: 15px; color: #005198;">ĐỐI SOÁT THÀNH CÔNG - ĐÃ CẤP VÉ!</strong>
              </div>
              <div class="form-subcard" style="border-left: 4px solid #047857;">
                <p style="font-size: 13px; color: #334155; margin-bottom: 8px;">
                  ${res.message}
                </p>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom: 4px;">
                  <span style="color:#64748b;">Mã đơn hàng:</span>
                  <strong style="color: #005198;">#${res.code}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom: 8px;">
                  <span style="color:#64748b;">Mã GD ngân hàng:</span>
                  <strong style="font-family:monospace;">${txid}</strong>
                </div>
                <a href="${res.ticket_url || 'ticket.html?order=' + res.code}" class="btn btn-primary btn-sm" style="background:#047857; border:none; width:100%; text-align:center; font-weight:800; display:block;">
                  <i class=ph-ticket aria-hidden=true></i> Mở Vé Xem Phim Ngay →
                </a>
              </div>
            `);
      }, 600);
      return;
    }

    if (res.ok && res.status === 'RECOVERED_REFUND') {
      setTimeout(() => {
        appendBotMessage(`
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                <span style="color: #b45309; font-size: 20px;"><i class=ph-warning aria-hidden=true></i></span>
                <strong style="font-size: 15px; color: #b45309;">GIAO DỊCH QUÁ HẠN GIỮ GHẾ</strong>
              </div>
              <div class="form-subcard" style="border-left: 4px solid #f59e0b;">
                <p style="font-size: 13px; color: #334155; margin-bottom: 8px;">
                  ${res.message}
                </p>
                <a href="${res.refund_url || 'refund.html?order=' + res.code}" class="btn btn-primary btn-sm" style="background:#f59e0b; border:none; width:100%; text-align:center; font-weight:800; display:block;">
                  <i class=ph-money-wavy aria-hidden=true></i> Nhận Lại Tiền Hoàn 100% Ngay →
                </a>
              </div>
            `);
      }, 600);
      return;
    }

    // Trường hợp tạo khiếu nại (Complaints)
    setTimeout(() => {
      appendBotMessage(`
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
              <span style="color: #4f46e5; font-size: 20px;"><i class=ph-note-pencil aria-hidden=true></i></span>
              <strong style="font-size: 15px; color: #4338ca;">ĐÃ TẠO PHIẾU KHIẾU NẠI CSKH</strong>
            </div>
            <div class="form-subcard" style="border-left: 4px solid #6366f1;">
              <p style="font-size: 13px; color: #334155; margin-bottom: 8px;">
                ${res.message}
              </p>
              <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom: 4px;">
                <span style="color:#64748b;">Mã hồ sơ:</span>
                <strong style="color: #4338ca;">#${res.complaint_code || ''}</strong>
              </div>
              <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                Bộ phận kiểm soát ngân hàng đang rà soát sao kê. Bạn có thể tra cứu trạng thái bất kỳ lúc nào.
              </div>
            </div>
          `);
    }, 600);

  } catch (err) {
    // Fallback UI nếu có sự cố
    setTimeout(() => {
      appendBotMessage(`
            <div style="color: #b91c1c; font-size: 13.5px;">
              <i class=ph-warning aria-hidden=true></i> Không thể kết nối cổng đối soát: ${err.message}. Vui lòng thử lại hoặc gửi yêu cầu ở Trung tâm hỗ trợ.
            </div>
          `);
    }, 500);
  }
}

// Flow 2: Theo Dõi Hoàn Tiền
// Tiến độ hoàn tiền: đọc hồ sơ hoàn THẬT của đơn (order-status), không vẽ sẵn tiến độ / số tiền / mã tham chiếu
const REFUND_STATUS_VI = { REQUESTED: 'Đang hoàn tự động về tài khoản đã chuyển', RETRYING: 'Đang hoàn tự động (hệ thống thử lại)', DONE: 'Đã hoàn tiền',
  MANUAL_REVIEW: 'Cần bạn khai tài khoản nhận hoàn', FORM_SUBMITTED: 'Đang đối chiếu hồ sơ', CS_APPROVED: 'Đang chờ duyệt chi', ACC_RETURNED: 'Đang đối chiếu lại hồ sơ', PAID_OUT: 'Đã chuyển khoản – chờ xác nhận' };
async function renderRefundTracker(code) {
  code = String(code || (currentActiveOrder && currentActiveOrder.code) || '').trim().toUpperCase();
  if (!/^BC\d{10}$/.test(code)) {
    awaitingRefundCode = true;
    appendBotMessage('<p>Bạn cho BetaBot xin <b>mã đơn hàng</b> (BC + 10 số, có trong email / SMS xác nhận) để tra cứu hoàn tiền, hoặc mở trang <a href="refund-track.html">Tra cứu hoàn tiền</a>.</p>');
    return;
  }
  awaitingRefundCode = false;
  let v = null;
  try { v = await Pay.call('order-status?code=' + encodeURIComponent(code)); }
  catch (e) {
    appendBotMessage('<p>Chưa tra được đơn <b>#' + escapeHtml(code) + '</b>: ' + escapeHtml(e.message) + '. Bạn kiểm tra lại mã đơn hoặc mở trang <a href="refund-track.html">Tra cứu hoàn tiền</a>.</p>');
    return;
  }
  const list = (v && v.refunds) || [];
  const r = (v && v.refund) || list[list.length - 1];
  if (!r) {
    appendBotMessage('<p>Đơn <b>#' + escapeHtml(code) + '</b> hiện <b>chưa có yêu cầu hoàn tiền</b>' + (v && v.status_label ? ' (trạng thái đơn: ' + escapeHtml(v.status_label) + ')' : '') + '.</p>' +
      '<p style="margin-top: 6px;">Nếu bạn đã chuyển tiền mà chưa nhận được vé, chọn <b>Đối soát chuyển khoản VietQR</b> để hệ thống tra lại ngân hàng.</p>');
    return;
  }
  const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0) + ' đ';
  const steps = Array.isArray(r.steps) && r.steps.length ? r.steps : [{ label: 'Đã tiếp nhận', done: true }, { label: 'Đã chuyển hoàn', done: r.status === 'DONE' }];
  const auto = !r.is_manual && (r.status === 'REQUESTED' || r.status === 'RETRYING');
  const note = r.status === 'DONE' ? 'Tiền đã được chuyển hoàn' + (r.refund_ref ? ' (mã giao dịch ' + escapeHtml(r.refund_ref) + ')' : '') + '. Thời gian tiền về tài khoản tùy ngân hàng.'
    : auto ? 'Hệ thống đang tự hoàn về đúng tài khoản đã chuyển; thường xong trong ít phút, có khi lâu hơn tùy ngân hàng.'
    : r.needs_form ? 'Bạn cần khai tài khoản nhận hoàn để nhân viên chuyển tiền: <a href="refund.html?order=' + encodeURIComponent(code) + '">mở form hoàn tiền</a>.'
    : 'Nhân viên đang xử lý hồ sơ hoàn tiền thủ công; bạn sẽ nhận email khi có kết quả.';
  appendBotMessage(`
        <strong style="font-size: 15px; color: #005198;">TIẾN ĐỘ HOÀN TIỀN</strong>
        <div class="form-subcard" style="margin-top: 8px;">
          <div style="display:flex; justify-content:space-between; gap: 8px; font-size:13px;"><span style="color:#475569;">Đơn hàng:</span><strong style="color:#005198; font-family:monospace;">#${escapeHtml(code)}</strong></div>
          <div style="display:flex; justify-content:space-between; gap: 8px; font-size:13px; margin-top:4px;"><span style="color:#475569;">Hồ sơ hoàn:</span><strong style="font-family:monospace;">${escapeHtml(r.code || '')}</strong></div>
          <div style="display:flex; justify-content:space-between; gap: 8px; font-size:13px; margin-top:4px;"><span style="color:#475569;">Số tiền hoàn:</span><strong style="color:#c94200; font-size:15px;">${vnd(r.amount)}</strong></div>
          ${r.reason_label ? `<div style="display:flex; justify-content:space-between; gap: 8px; font-size:13px; margin-top:4px;"><span style="color:#475569;">Lý do:</span><strong style="text-align: right;">${escapeHtml(r.reason_label)}</strong></div>` : ''}
          <div style="display:flex; justify-content:space-between; gap: 8px; font-size:13px; margin-top:4px;"><span style="color:#475569;">Trạng thái:</span><strong style="text-align: right;">${escapeHtml(REFUND_STATUS_VI[r.status] || r.status || '')}</strong></div>
          <div style="margin-top: 10px;"><div class="chat-stepper">${steps.map(s => `
            <div class="chat-step-item"><div class="chat-step-bar ${s.done ? 'done' : ''}"></div>
              <div style="font-size: 12px; font-weight: 700; color: ${s.done ? '#047857' : '#475569'};">${escapeHtml(s.label || '')}</div></div>`).join('')}</div></div>
          <p style="font-size: 13px; color: #334155; margin: 10px 0 0;">${note}</p>
        </div>
        <a href="refund-track.html?order=${encodeURIComponent(code)}" class="btn btn-primary btn-sm" style="display:inline-block; margin-top: 10px; font-size: 12.5px;">Xem chi tiết hồ sơ hoàn tiền</a>
      `);
}

function renderComplaintFlow() {
  appendBotMessage(`
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span style="color: #f59e0b; font-size: 16px;"><i class=ph-warning aria-hidden=true></i></span>
          <strong style="font-size: 14.5px;">KHIẾU NẠI SỰ CỐ THANH TOÁN 24H</strong>
        </div>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
          Hạn khiếu nại trong vòng 24 giờ kể từ lúc chuyển khoản · <strong>Còn 14 giờ 25 phút</strong>
        </p>
        <div class="form-subcard" role="form">
          <label class="chat-field">
            Mã đặt vé hoặc mã đơn
            <input type="text" class="chat-input-text" id="comp-order-code" value="${currentActiveOrder ? currentActiveOrder.code : ''}" readonly style="background:#f8fafc; font-weight:700; color:#005198;">
          </label>
          <label class="chat-field">
            Số điện thoại liên hệ
            <input type="text" class="chat-input-text" id="comp-phone" value="${currentActiveOrder ? currentActiveOrder.customerPhone : ''}">
          </label>
          <label class="chat-field">
            Mã giao dịch ngân hàng
            <input type="text" class="chat-input-text" id="comp-txid" value="${currentActiveOrder ? ('FT' + currentActiveOrder.code.replace(/\D/g, '').slice(-8)) : ''}">
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <label class="chat-field">
              Số tiền đơn hàng
              <input type="text" class="chat-input-text" id="comp-amount" value="${currentActiveOrder ? (new Intl.NumberFormat('vi-VN').format(currentActiveOrder.total) + ' đ') : ''}">
            </label>
            <label class="chat-field">
              Giờ chuyển
              <input type="text" class="chat-input-text" id="comp-time" value="${currentActiveOrder ? (currentActiveOrder.time || '18:30') : ''}">
            </label>
          </div>
          <label class="chat-field">
            Mô tả sự cố chi tiết
            <textarea id="comp-desc" style="min-height:70px; border-radius:8px; border:1px solid #cbd5e1; padding:8px 12px; font-family:inherit; font-size:13px;">Tôi chuyển khoản VietQR thanh toán cho đơn hàng #${currentActiveOrder ? currentActiveOrder.code : ''} phim ${currentActiveOrder ? currentActiveOrder.movieTitle : ''} (${currentActiveOrder ? (new Intl.NumberFormat('vi-VN').format(currentActiveOrder.total) + ' đ') : ''}) nhưng chưa được duyệt vé.</textarea>
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:12.5px; cursor:pointer;">
            <input type="checkbox" checked style="width:16px; height:16px;"> Tôi xác nhận các thông tin trên là chính xác
          </label>
          <button class="btn btn-primary btn-sm" data-on-click="submitComplaint()" style="background:#c53030; border:none; padding:10px; font-weight:800; border-radius:8px;">
            Gửi Khiếu Nại Cho Đơn #${currentActiveOrder ? currentActiveOrder.code : ''} Ngay
          </button>
        </div>
      `);
}

async function submitComplaint() {
  const val = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const code = val('comp-order-code').toUpperCase();
  appendUserMessage('Đã gửi thông tin khiếu nại sự cố chuyển khoản.');
  if (!code) {
    appendBotMessage('Vui lòng mở chatbot từ đơn hàng cần khiếu nại (nút “Báo cáo lỗi” trong lịch sử đơn) để mình biết đúng mã đơn nhé.');
    return;
  }
  try {
    const r = await Pay.reportIssue(code, {
      note: [val('comp-desc'), 'SĐT liên hệ: ' + val('comp-phone'), 'Số tiền: ' + val('comp-amount'), 'Thời gian CK: ' + val('comp-time')].join(' | '),
      bank_ref: val('comp-txid')
    });
    const esc = (x) => String(x || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    appendBotMessage(`
          <div style="text-align: center; padding: 10px 0;">
            <div style="font-size: 28px; margin-bottom: 6px;"><i class=ph-confetti aria-hidden=true></i></div>
            <strong style="color: #047857; font-size: 15px;">ĐÃ TIẾP NHẬN KHIẾU NẠI THÀNH CÔNG!</strong>
            <p style="font-size: 13px; color: #475569; margin: 6px 0 10px;">
              Mã hồ sơ: <strong>#${esc(r.ticket_code)}</strong> · Trạng thái đơn: <strong>${esc(r.status_label)}</strong>.<br>
              Hệ thống đã tra cứu lại cổng thanh toán ngay; CSKH sẽ liên hệ số <strong>${esc(val('comp-phone') || r.phone)}</strong> nếu cần thêm thông tin.
            </p>
            <div style="display:flex; justify-content:center; gap:10px;">
              <a href="order.html?code=${encodeURIComponent(code)}" class="btn btn-outline btn-sm">Theo Dõi Đơn Hàng</a>
              <a href="home.html" class="btn btn-primary btn-sm">Về Trang Chủ</a>
            </div>
          </div>`);
  } catch (err) {
    appendBotMessage('Chưa gửi được khiếu nại: ' + err.message + '. Bạn vui lòng thử lại hoặc gửi yêu cầu ở Trung tâm hỗ trợ.');
  }
}

function resetConversation() {
  chatBox.innerHTML = `
        <div class="msg-row bot">
          <img loading="lazy" decoding="async" src="images/betabot-avatar.webp" alt="Bot" class="msg-avatar" data-fallback="images/logo-official.png">
          <div class="bot-bubble">
            <p style="margin-bottom: 8px;">
              Xin chào! Mình là <strong>BetaBot</strong> — trợ lý tự động hỗ trợ đối soát & giải quyết sự cố thanh toán của Beta Cinemas.
            </p>
            <p style="margin-bottom: 8px;">
              Bạn đang gặp tình huống nào cần xử lý ngay?
            </p>
            <div class="chat-chips-group">
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('reconcile')"><i class=ph-lightning aria-hidden=true></i> Đã thanh toán nhưng không xuất được vé</button>
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('refund')"><i class=ph-magnifying-glass aria-hidden=true></i> Kiểm tra trạng thái hoàn tiền</button>
              <button class="chat-chip-btn" data-on-click="triggerQuickAction('complaint')"><i class=ph-note-pencil aria-hidden=true></i> Khiếu nại chuyển khoản khác</button>
            </div>
          </div>
        </div>
      `;
  scrollToBottom();
}

function escapeHtml(string) {
  return String(string).replace(/[&<>"'`=\/]/g, function (s) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    }[s];
  });
}

// Hiển thị thẻ báo lỗi đơn hàng riêng biệt nếu chuyển từ trang tài khoản sang
function renderOrderContextGreeting(order) {
  setTimeout(() => {
    appendBotMessage(`
          <p>Xin chào! Mình là <strong>BetaBot</strong>. Mình đã nhận được yêu cầu <strong>báo cáo sự cố thanh toán</strong> cho đơn hàng sau từ lịch sử đặt vé của bạn:</p>
          <div class="form-subcard" style="border-left: 4px solid #3b82f6; background: #f8fafc; padding: 14px 16px; margin: 10px 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <span class="badge" style="background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 800; padding: 3px 8px; border-radius: 4px;">
                  <i class=ph-hourglass-medium aria-hidden=true></i> ĐÃ TIẾP NHẬN BÁO CÁO - ĐANG XỬ LÝ HOÀN TIỀN
                </span>
                <h4 style="font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 6px;">${order.movieTitle}</h4>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 12px; color: #64748b;">Mã đơn hàng:</div>
                <strong style="font-family: monospace; font-size: 15px; color: #005198;">${order.code}</strong>
              </div>
            </div>

            <div style="font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 12px; background: white; padding: 10px 12px; border-radius: 8px; border: 1px solid #f1f5f9;">
              <i class=ph-map-pin aria-hidden=true></i> Rạp: <strong>${order.cinema}</strong><br>
              <i class=ph-clock aria-hidden=true></i> Suất chiếu: <strong>${order.showtime}</strong><br>
              <i class=ph-armchair aria-hidden=true></i> Ghế: <strong>${order.seats}</strong><br>
              <i class=ph-coins aria-hidden=true></i> Số tiền đơn hàng: <strong style="color: #c94200; font-size: 14px;">${new Intl.NumberFormat('vi-VN').format(order.total)} đ</strong><br>
              <i class=ph-hourglass-medium aria-hidden=true></i> Tình trạng: <span style="font-weight: 700; color: #2563eb;">${order.statusText}</span>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-primary btn-sm" data-on-click="triggerQuickAction('reconcile')" style="background: #c94200; border-color: #c94200; font-weight: 700;">
                <i class=ph-lightning aria-hidden=true></i> Đối Soát Chuyển Khoản Ngay
              </button>
              <button class="btn btn-outline btn-sm" data-on-click="triggerQuickAction('complaint')" style="border-color: #cbd5e1; color: #005198; font-weight: 700;">
                <i class=ph-note-pencil aria-hidden=true></i> Gửi Phiếu Khiếu Nại CSKH
              </button>
              <a href="account.html" class="btn btn-outline btn-sm" style="color: #64748b;">
                ← Quay Lại Lịch Sử Đơn
              </a>
            </div>
          </div>
          <p style="font-size: 13.5px; color: #334155; margin-top: 6px;">
            Nếu bạn đã bị trừ tiền từ tài khoản ngân hàng nhưng chưa được duyệt vé, bạn hãy bấm nút <strong>"Đối Soát Chuyển Khoản Ngay"</strong> để hệ thống tự động kiểm tra sao kê ngân hàng và cấp vé tức thì nhé!
          </p>
        `);
  }, 300);
}

// Đọc URL query để điền sẵn nếu chuyển từ trang tài khoản / thanh toán bị lỗi sang
window.addEventListener('DOMContentLoaded', async () => {
  const p = new URLSearchParams(window.location.search);
  const ref = p.get('ref');
  const orderCode = p.get('order');

  if (orderCode) {
    try {
      let list = JSON.parse(localStorage.getItem('reported_refund_orders') || '[]');
      if (!list.includes(orderCode)) {
        list.push(orderCode);
        localStorage.setItem('reported_refund_orders', JSON.stringify(list));
      }
    } catch(e) {}
    currentActiveOrder = await resolveOrderInfo(orderCode);
    if (currentActiveOrder) renderOrderContextGreeting(currentActiveOrder);
    else appendBotMessage('<p>Không tìm thấy đơn <b>#' + escapeHtml(orderCode) + '</b>. Bạn kiểm tra lại mã đơn trong email / SMS nhé.</p>');
  } else if (ref) {
    setTimeout(() => {
      triggerQuickAction('reconcile');
      setTimeout(() => {
        const txEl = document.getElementById('recon-txid');
        if (txEl) txEl.value = ref;
      }, 400);
    }, 300);
  }
});
