// js/admin.js - mã của admin.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Live Server (port 55xx) hoặc file:// -> server Node port 5000; còn lại API cùng nguồn
const API = (/^55\d\d$/.test(location.port) || location.protocol === 'file:') ? 'http://localhost:5000/api/' : '/api/';
let TOKEN = '';
try { TOKEN = sessionStorage.getItem('beta_staff_token') || ''; } catch (e) {}
let ME = null;
let tab = null;
let overview = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
const t = (iso) => iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '';
const STATUS_TONE = { PENDING: 'warn', EXPIRED: 'warn', CONFIRMED: 'ok', CONFIRMED_LATE: 'ok', REFUND_REQUESTED: 'info', REFUNDED: 'muted', MANUAL_REVIEW: 'danger', CANCELLED: 'muted', FAILED: 'danger' };
const RF_LABEL = { REQUESTED: 'Mới tạo', RETRYING: 'Đang gửi lại (30 phút/lần)', DONE: 'Hoàn tất', MANUAL_REVIEW: 'Chờ khách bổ sung', FORM_SUBMITTED: 'Chờ nhân viên đối chiếu', CS_APPROVED: 'Đã gửi – chờ Kế toán', ACC_RETURNED: 'Kế toán trả về', PAID_OUT: 'Kế toán đã chi – chờ xác nhận' };
const RF_TONE = { REQUESTED: 'info', RETRYING: 'warn', DONE: 'ok', MANUAL_REVIEW: 'muted', FORM_SUBMITTED: 'warn', CS_APPROVED: 'info', ACC_RETURNED: 'danger', PAID_OUT: 'info' };
// Bộ lọc hồ sơ thủ công của nhân viên (theo thứ tự ưu tiên xử lý)
const CS_FILTERS = [
  ['TODO', 'Cần xử lý', ['ACC_RETURNED', 'FORM_SUBMITTED', 'PAID_OUT']],
  ['ACC_RETURNED', 'Kế toán trả về', ['ACC_RETURNED']],
  ['FORM_SUBMITTED', 'Chờ đối chiếu', ['FORM_SUBMITTED']],
  ['MANUAL_REVIEW', 'Chờ khách bổ sung', ['MANUAL_REVIEW']],
  ['CS_APPROVED', 'Đã gửi Kế toán', ['CS_APPROVED']],
  ['PAID_OUT', 'Kế toán đã chi', ['PAID_OUT']],
  ['DONE', 'Hoàn tất', ['DONE']]
];
const MANUAL = ['MANUAL_REVIEW', 'FORM_SUBMITTED', 'CS_APPROVED', 'ACC_RETURNED', 'PAID_OUT', 'DONE'];
let csFilter = 'TODO';
// Nút chip lọc hồ sơ hoàn tiền (data-on-click="setCsFilter('PAID_OUT')")
function setCsFilter(k) { csFilter = k; renderCsRefunds(); }
const selected = new Set();
let csVisible = [];

// Quyền của nhân viên đang đăng nhập (MANAGER = '*')
const can = (perm) => !!ME && (ME.perms.includes('*') || ME.perms.includes(perm));
const isManager = () => !!ME && ME.role === 'MANAGER';
// Tab hiển thị theo vai trò
const TAB_RULE = {
  tongquan: () => can('report.view'),
  cskh: () => can('refund.decide') || can('ticket.view'),
  ketoan: () => can('refund.pay') || can('report.view'),
  quay: () => can('ticket.checkin'),
  it: isManager, nhansu: isManager, danhmuc: () => can('catalog.manage')
};
const TK_LABEL = { GENERAL: 'Yêu cầu hỗ trợ', PAYMENT_REPORT: 'Khách báo lỗi', MANUAL_REVIEW: 'Hoàn tiền thủ công', DATA_MISMATCH: 'Dữ liệu lệch', UNMATCHED_TX: 'Tiền không khớp đơn' };
const TK_STATUS = { OPEN: 'Mới / cần xử lý', WAITING_CUSTOMER: 'Chờ khách cập nhật', WAITING_ACCOUNTING: 'Chờ Kế toán' };
const pill = (txt, tone) => `<span class="pill p-${tone || 'muted'}">${esc(txt)}</span>`;


// ===================== Đợt 11: công cụ giao diện dùng chung =====================
const CANCEL = Symbol('huy-thao-tac');
const TAB_TITLE = { tongquan: 'Tổng quan', cskh: 'Chăm sóc khách hàng', ketoan: 'Kế toán', danhmuc: 'Danh mục', quay: 'Quầy soát vé', it: 'IT / Vận hành', nhansu: 'Nhân sự & nhật ký' };
// Trang mở đầu theo vai trò: Quầy vào thẳng soát vé, CSKH vào hàng đợi, Kế toán vào bàn duyệt chi
const LANDING = { COUNTER: 'quay', CS: 'cskh', ACCOUNTANT: 'ketoan', MANAGER: 'tongquan' };
const canTab = (n) => Object.prototype.hasOwnProperty.call(TAB_RULE, n) && !!TAB_RULE[n]();
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(-2).map(w => w[0] || '').join('').toUpperCase();
let dmGroup = '';

// Thông báo nhỏ góc dưới: thành công tự tắt sau ~4,5 giây, lỗi giữ tới khi bấm đóng
function toast(msg, tone = 'ok', ms) {
  const box = document.getElementById('toasts');
  if (!box || !msg) return null;
  const el = document.createElement('div');
  el.className = 'toast ' + (tone === 'ok' ? '' : tone);
  el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  const ico = tone === 'danger' || tone === 'warn' ? 'ph-warning' : tone === 'info' ? 'ph-info' : 'ph-check-circle';
  el.innerHTML = `<i class="${ico}" aria-hidden="true" style="margin-top: 2px;"></i><span>${esc(msg)}</span><button type="button" class="x" aria-label="Đóng thông báo">×</button>`;
  el.querySelector('.x').onclick = () => el.remove();
  box.appendChild(el);
  while (box.children.length > 4) box.firstElementChild.remove();
  const life = ms != null ? ms : (tone === 'danger' ? 0 : 4500);
  if (life) setTimeout(() => el.remove(), life);
  return el;
}

// Hộp thoại trong trang thay alert / confirm / prompt của trình duyệt (không chặn trang, hiện đủ ngữ cảnh, có nút Hủy rõ ràng)
//   body  : HTML đã thoát ký tự (tự dựng bằng esc())
//   fields: [{ name, label, type, value, required, multiline, rows, placeholder, hint, options: [[value, label]], minlength, maxlength, inputmode, autocomplete, trim, validate(v, form) }]
//   Trả về: object giá trị các ô khi bấm nút chính, null khi hủy / Esc
function uiDialog({ title = '', body = '', fields = [], confirmLabel = 'Đồng ý', cancelLabel = 'Hủy', danger = false, hideCancel = false } = {}) {
  const dlg = document.getElementById('ui-dlg');
  if (dlg.open) dlg.close();
  const prev = document.activeElement;
  return new Promise((resolve) => {
    const fieldHtml = (f) => {
      const attrs = [f.required ? 'required' : '', f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '', f.maxlength ? `maxlength="${f.maxlength}"` : '',
        f.inputmode ? `inputmode="${f.inputmode}"` : '', `autocomplete="${f.autocomplete || 'off'}"`].join(' ');
      const ctl = f.options ? `<select name="${f.name}" ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : f.multiline ? `<textarea name="${f.name}" rows="${f.rows || 3}" ${attrs}>${esc(f.value || '')}</textarea>`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value == null ? '' : f.value)}" ${attrs}>`;
      return `<label class="field">${esc(f.label)}${ctl}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
    };
    dlg.innerHTML = `<form method="dialog" novalidate>
          <h3 id="ui-dlg-title" class="${danger ? 'danger' : ''}">${esc(title)}</h3>
          ${body ? `<div class="ui-body" id="ui-dlg-desc">${body}</div>` : ''}
          ${fields.map(fieldHtml).join('')}
          <div class="ui-err" role="alert"></div>
          <div class="row-actions dlg-actions">${hideCancel ? '' : `<button type="button" class="btn" data-act="cancel">${esc(cancelLabel)}</button>`}<button type="submit" class="btn ${danger ? 'danger-solid' : 'primary'}">${esc(confirmLabel)}</button></div>
        </form>`;
    const form = dlg.querySelector('form'), err = dlg.querySelector('.ui-err');
    if (body) dlg.setAttribute('aria-describedby', 'ui-dlg-desc'); else dlg.removeAttribute('aria-describedby');
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; if (dlg.open) dlg.close(); resolve(v); try { if (prev && prev.isConnected && prev.focus) prev.focus(); } catch (e) {} };
    const cancelBtn = form.querySelector('[data-act="cancel"]');
    if (cancelBtn) cancelBtn.onclick = () => done(null);
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    dlg.onclose = () => done(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        const v = f.trim === false ? el.value : el.value.trim();
        let msg = '';
        if (f.required && !v) msg = 'Vui lòng nhập: ' + f.label;
        else if (f.minlength && v.length < f.minlength) msg = f.label + ': cần ít nhất ' + f.minlength + ' ký tự';
        else if (f.validate) msg = f.validate(v, form) || '';
        if (msg) { err.textContent = msg; el.focus(); return; }
        out[f.name] = v;
      }
      done(out);
    };
    dlg.showModal();
    const first = form.querySelector('input:not([type=hidden]), textarea, select');
    (first || (danger && cancelBtn) || form.querySelector('[type=submit]')).focus();
  });
}
const uiConfirm = (opts) => uiDialog(typeof opts === 'string' ? { title: opts } : opts).then(r => r !== null);
const uiPrompt = (opts) => uiDialog({ ...opts, fields: [{ name: 'v', label: opts.label || '', value: opts.value, required: opts.required, multiline: opts.multiline, rows: opts.rows,
  type: opts.type, placeholder: opts.placeholder, hint: opts.hint, minlength: opts.minlength, inputmode: opts.inputmode, validate: opts.validate, trim: opts.trim }] }).then(r => r ? r.v : null);
const kvHtml = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<span>${esc(k)}</span><b>${v}</b>`).join('')}</div>`;

// Môi trường dữ liệu: luôn thấy đang ở dữ liệu thật hay bản chạy thử
function setEnv(kind) {
  const el = document.getElementById('env');
  const map = { live: ['Dữ liệu thật', 'env-live', 'Đang dùng database Supabase thật'], mock: ['Bản chạy thử', 'env-mock', 'Dữ liệu nằm trong bộ nhớ máy chủ, mất khi khởi động lại'], missing: ['Chưa nối database', 'env-missing', 'Web thật chưa nối Supabase – đặt vé đang khóa'] };
  const [txt, cls, tip] = map[kind] || ['—', '', ''];
  el.textContent = txt; el.className = 'env ' + cls; el.title = tip;
}

// Menu chức năng (điện thoại) và menu tài khoản
function toggleNav(open) {
  const on = open == null ? !document.body.classList.contains('nav-open') : !!open;
  document.body.classList.toggle('nav-open', on);
  document.getElementById('nav-scrim').hidden = !on;
  document.getElementById('nav-toggle').setAttribute('aria-expanded', String(on));
  if (on) { const b = document.querySelector('#tabs button.on') || document.querySelector('#tabs button[data-tab]:not([hidden])'); if (b) b.focus(); }
  else { const tg = document.getElementById('nav-toggle'); if (document.getElementById('tabs').contains(document.activeElement) && tg.offsetParent) tg.focus(); }
}
function toggleUserMenu(open) {
  const menu = document.getElementById('who-menu'), btn = document.getElementById('who-btn');
  const on = open == null ? menu.hidden : !!open;
  menu.hidden = !on; btn.setAttribute('aria-expanded', String(on));
  if (on) menu.querySelector('button').focus();
}
const closeUserMenu = () => toggleUserMenu(false);
document.addEventListener('click', (e) => { const m = document.getElementById('who-menu'); if (m && !m.hidden && !e.target.closest('#who')) closeUserMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!document.getElementById('who-menu').hidden) { closeUserMenu(); document.getElementById('who-btn').focus(); return; }
  if (document.body.classList.contains('nav-open')) { toggleNav(false); return; }
  if (document.getElementById('drawer').classList.contains('open')) { closeDrawer(); return; }
  if (document.body.classList.contains('kiosk')) exitKiosk();
});

// Bảng thành thẻ trên điện thoại: gắn nhãn cột (data-label) cho mọi ô sau mỗi lần vẽ lại
function labelTables(root) {
  (root || document).querySelectorAll('table:not([data-rt])').forEach(tb => {
    const head = tb.tHead; if (!head || !head.rows.length) return;
    tb.dataset.rt = '1'; tb.classList.add('rt');
    const labels = [...head.rows[0].cells].map(c => c.textContent.trim());
    [...tb.tBodies].forEach(b => [...b.rows].forEach(tr => [...tr.cells].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', labels[i] || ''); })));
  });
}
let rtRaf = 0;
new MutationObserver(() => { cancelAnimationFrame(rtRaf); rtRaf = requestAnimationFrame(() => labelTables(document)); }).observe(document.body, { childList: true, subtree: true });

// Ngăn kéo chi tiết: có nút "Quay lại" (phiếu → khách → đơn), Esc để đóng, trả focus về chỗ cũ
let drawerKey = null, drawerOpener = null;
const drawerStack = [];
function drawerNav(key, back) {
  const isOpen = document.getElementById('drawer').classList.contains('open');
  if (!isOpen) { drawerStack.length = 0; drawerOpener = document.activeElement; }
  else if (!back && drawerKey && drawerKey !== key) drawerStack.push(drawerKey);
  drawerKey = key;
  document.getElementById('d-back').hidden = !drawerStack.length;
}
function showDrawer() {
  const d = document.getElementById('drawer');
  const was = d.classList.contains('open');
  d.classList.add('open');
  document.querySelectorAll('header.topbar, #tabs, main').forEach(el => { el.inert = true; });
  document.getElementById('drawer-scrim').hidden = false;
  if (!was) setTimeout(() => d.focus(), 60);
}
function drawerBack() {
  const k = drawerStack.pop(); if (!k) return;
  const i = k.indexOf(':'), type = k.slice(0, i), id = k.slice(i + 1);
  ({ order: openOrder, ticket: openTicket, cust: openCustomer })[type](id, true);
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-scrim').hidden = true;
  drawerStack.length = 0; drawerKey = null;
  document.getElementById('d-back').hidden = true;
  document.querySelectorAll('header.topbar, #tabs, main').forEach(el => { el.inert = false; });
  try { if (drawerOpener && drawerOpener.isConnected && drawerOpener.focus) drawerOpener.focus(); } catch (e) {}
  drawerOpener = null;
}

// Đang thao tác thì không tự làm mới (tránh mất chữ đang gõ, mất chỗ đang xem)
function userBusy() {
  if (acting) return true;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('main, #drawer') && a.type !== 'checkbox') return true;
  return !!document.querySelector('dialog[open]') || document.getElementById('drawer').classList.contains('open');
}

// IT: đèn trạng thái tổng (database, cấu trúc dữ liệu, thanh toán SePay) đọc từ /api/health?schema=1
async function loadHealthLights() {
  const box = document.getElementById('it-lights'); if (!box) return;
  box.innerHTML = '<div class="loading">Đang kiểm tra hệ thống…</div>';
  try {
    const h = await (await fetch(API + 'health?schema=1', { cache: 'no-store' })).json();
    const sch = h.schema || {}, pay = h.payments || {}, live = h.mode === 'live';
    const light = (ok, title, detail) => `<div class="kpi ${ok ? '' : 'tone-danger'}"><b><span style="color: ${ok ? 'var(--ok)' : 'var(--danger)'};" aria-hidden="true">●</span> ${ok ? 'Ổn' : 'Cần xử lý'}</b><span><b style="display: inline; font-size: 13px; color: var(--text);">${esc(title)}</b> · ${detail}</span></div>`;
    box.innerHTML = '<div class="kpis">' + [
      light(h.db === 'ok', 'Database', live ? 'Supabase – dữ liệu thật' : h.mode === 'mock' ? 'bộ nhớ trong – bản chạy thử' : 'chưa nối'),
      light(sch.ok !== false, 'Cấu trúc dữ liệu', sch.ok === false ? 'thiếu bảng / cột của ' + (sch.missing || []).length + ' migration' : live ? 'đủ ' + (sch.tables || '') + ' bảng' : 'bản thử – không cần kiểm tra'),
      light(!live || pay.ok === true, 'Thanh toán SePay', !live ? 'bản thử – dùng Sandbox' : pay.last_webhook ? 'webhook gần nhất ' + esc(t(pay.last_webhook.at)) + ' · ' + esc(pay.last_webhook.result || '') : 'chưa nhận webhook nào')
    ].join('') + '</div>' + (live ? (pay.hints || []).concat(sch.hint ? [sch.hint] : []) : []).map(x => `<div class="alert warn">${esc(x)}</div>`).join('');
  } catch (e) { box.innerHTML = '<div class="alert warn">Không đọc được /api/health: ' + esc(e.message) + '</div>'; }
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN && !/action=(login|bootstrap)/.test(path)) { logout(true); }
  if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e; }
  return j;
}
const post = (action, body) => api('admin', { method: 'POST', body: JSON.stringify({ action, ...body }) });

// Dòng thông báo ở màn đăng nhập: lỗi (đỏ) hoặc hướng dẫn (xanh, vd bước nhập mã 6 số)
function loginMsg(text, isErr = true) { const el = document.getElementById('login-err'); el.textContent = text || ''; el.className = isErr ? '' : 'info'; }
async function login() {
  loginMsg('');
  const btn = document.getElementById('lg-btn'), otpEl = document.getElementById('lg-otp'), otpRow = document.getElementById('lg-otp-row');
  btn.disabled = true; btn.textContent = 'Đang đăng nhập…';
  try {
    const r = await post('login', { email: document.getElementById('lg-email').value, password: document.getElementById('lg-pass').value, otp: otpEl.value.trim() || undefined });
    otpEl.value = ''; otpRow.hidden = true;
    TOKEN = r.token;
    try { sessionStorage.setItem('beta_staff_token', TOKEN); } catch (e) {}
    document.getElementById('lg-pass').value = '';
    await enter();
  } catch (e) {
    if (ME) { toast(e.message, 'danger'); return; }
    if (e.data && e.data.need_otp) { otpRow.hidden = false; otpEl.value = ''; otpEl.focus(); loginMsg('Nhập mã 6 số đang hiện trong ứng dụng xác thực (Google / Microsoft Authenticator) rồi bấm Đăng nhập.', false); }
    else loginMsg(e.message);
  } finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
}

// ---- Bảo mật 2 lớp (Đợt 6) ----
async function open2fa(forced) {
  const box = document.getElementById('twofa'), body = document.getElementById('twofa-body'), msg = document.getElementById('twofa-msg');
  box.hidden = false; msg.textContent = forced ? 'Quản lý yêu cầu mọi nhân viên bật đăng nhập 2 lớp trước khi làm việc.' : '';
  box.scrollIntoView({ behavior: 'smooth' });
  if (ME.totp_enabled) {
    body.innerHTML = `<p>Đang <b style="color:#15803d">BẬT</b>. Muốn tắt, nhập mã 6 số hiện tại:</p>
          <input id="tf-code" inputmode="numeric" maxlength="6" placeholder="Mã 6 số" style="letter-spacing:4px"> <button class="btn danger" data-on-click="disable2fa()">Tắt bảo mật 2 lớp</button>`;
    return;
  }
  body.innerHTML = `<ol style="line-height:1.8;margin:0 0 10px;padding-left:20px">
          <li>Cài <b>Google Authenticator</b> hoặc <b>Microsoft Authenticator</b> trên điện thoại.</li>
          <li>Bấm <button class="btn" data-on-click="setup2fa()">Thiết lập</button> rồi quét mã QR hiện ra (hoặc nhập khóa bằng tay).</li>
          <li>Nhập mã 6 số ứng dụng đang hiện để bật.</li></ol>
        <div id="tf-qr" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"></div>
        <div style="margin-top:10px"><input id="tf-code" inputmode="numeric" maxlength="6" placeholder="Mã 6 số" style="letter-spacing:4px"> <button class="btn primary" data-on-click="enable2fa()">Bật</button></div>`;
}
async function setup2fa() {
  try {
    const r = await post('totp_setup', {});
    const box = document.getElementById('tf-qr');
    box.innerHTML = '<div id="tf-qr-img" style="background:#fff;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div><div class="hint">Không quét được? Nhập khóa:<br><b class="mono" style="font-size:14px;word-break:break-all">' + esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '</b></div>';
    if (window.QRCode) new QRCode(document.getElementById('tf-qr-img'), { text: r.otpauth, width: 168, height: 168 });
  } catch (e) { document.getElementById('twofa-msg').textContent = e.message; }
}
async function enable2fa() {
  try {
    ME = { ...ME, ...(await post('totp_enable', { code: val('tf-code') })).staff };
    document.getElementById('twofa-msg').textContent = '✓ Đã bật. Lần đăng nhập sau cần mã 6 số.';
    await open2fa();
    if (!document.getElementById('tabs').style.display || document.getElementById('tabs').style.display === 'none') await enter();
  } catch (e) { document.getElementById('twofa-msg').textContent = e.message; }
}
async function disable2fa() {
  try {
    ME = { ...ME, ...(await post('totp_disable', { code: val('tf-code') })).staff };
    document.getElementById('twofa-msg').textContent = 'Đã tắt bảo mật 2 lớp.';
    await open2fa();
  } catch (e) { document.getElementById('twofa-msg').textContent = e.message; }
}
const reset2fa = (id) => act(async () => {
  if (!(await uiConfirm({ title: 'Tắt bảo mật 2 lớp của nhân viên này?', body: 'Dùng khi nhân viên mất điện thoại. Họ sẽ phải thiết lập lại ở lần đăng nhập sau.', confirmLabel: 'Tắt bảo mật 2 lớp', danger: true }))) return CANCEL;
  await post('staff_reset_2fa', { id }); await loadStaff();
}, 'Đã tắt bảo mật 2 lớp của nhân viên');

async function bootstrap() {
  const err = document.getElementById('login-err');
  err.textContent = '';
  try {
    const email = document.getElementById('bt-email').value, password = document.getElementById('bt-pass').value;
    await post('bootstrap', { admin_key: document.getElementById('bt-key').value, full_name: document.getElementById('bt-name').value, email, password });
    document.getElementById('lg-email').value = email;
    document.getElementById('lg-pass').value = password;
    await login();
  } catch (e) {
    err.textContent = e.message;
  }
}

function logout(expired) {
  stopCamera(); exitKiosk();
  TOKEN = ''; ME = null; overview = null;
  try { sessionStorage.removeItem('beta_staff_token'); } catch (e) {}
  closeUserMenu(); closeDrawer(); toggleNav(false);
  document.body.classList.remove('authed');
  document.getElementById('who').hidden = true;
  document.getElementById('tabs').style.display = 'none';
  document.querySelectorAll('main > section').forEach(x => { x.hidden = true; });
  document.getElementById('login').hidden = false;
  document.getElementById('twofa').hidden = true;
  document.getElementById('twofa-body').innerHTML = '';
  document.getElementById('twofa-msg').textContent = '';
  ckHistory = []; try { sessionStorage.removeItem('beta_ck_hist'); } catch (e) {}
  document.getElementById('ck-result').innerHTML = ''; renderCkHistory();
  document.documentElement.classList.remove('dm-open');
  if (!expired) { tab = null; dmGroup = ''; if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
  document.getElementById('page-title').textContent = '';
  document.title = 'Quản trị · Beta Cinemas';
  if (expired) loginMsg('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  initLogin();
}

// Đổi mật khẩu trong hộp thoại: ô mật khẩu che chữ, có ô nhập lại để tránh gõ nhầm
async function changeMyPassword() {
  closeUserMenu();
  const r = await uiDialog({ title: 'Đổi mật khẩu', confirmLabel: 'Đổi mật khẩu', fields: [
    { name: 'cur', label: 'Mật khẩu hiện tại', type: 'password', required: true, autocomplete: 'current-password', trim: false },
    { name: 'nw', label: 'Mật khẩu mới', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'Ít nhất 8 ký tự', trim: false },
    { name: 'nw2', label: 'Nhập lại mật khẩu mới', type: 'password', required: true, autocomplete: 'new-password', trim: false,
      validate: (v, f) => (v !== f.elements.nw.value ? 'Hai lần nhập mật khẩu mới không giống nhau' : '') }] });
  if (!r) return;
  try {
    await post('change_password', { current_password: r.cur, new_password: r.nw });
    toast('Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.');
    logout();
  } catch (e) { toast(e.message, 'danger'); }
}

async function enter() {
  ME = (await api('admin?action=me')).staff;
  document.getElementById('who-name').textContent = ME.full_name;
  document.getElementById('who-role').textContent = ME.role_label;
  document.getElementById('who-avatar').textContent = initials(ME.full_name);
  document.getElementById('who').hidden = false;
  document.getElementById('login').hidden = true;
  // Môi trường dữ liệu cho mọi vai trò (kể cả Quầy – không tải overview)
  api('admin?action=status').then(st => setEnv(st.db_missing ? 'missing' : st.live_db ? 'live' : 'mock')).catch(() => {});
  // Bắt buộc 2 lớp (STAFF_REQUIRE_2FA=1) mà chưa bật -> chỉ hiện phần thiết lập
  if (ME.require_2fa && !ME.totp_enabled) { document.getElementById('tabs').style.display = 'none'; return open2fa(true); }
  document.body.classList.add('authed');
  document.getElementById('tabs').style.display = 'flex';
  document.querySelectorAll('#tabs button[data-tab]').forEach(btn => { btn.hidden = !canTab(btn.dataset.tab); });
  document.querySelectorAll('#tabs .nav-group').forEach(g => { g.hidden = ![...g.querySelectorAll('button[data-tab]')].some(b => !b.hidden); });
  const visible = [...document.querySelectorAll('#tabs button[data-tab]')].filter(b => !b.hidden);
  document.getElementById('nav-toggle').hidden = visible.length <= 1;
  try { await load(); } catch (e) { if (!ME) throw e; toast('Không tải được dữ liệu: ' + e.message, 'danger'); }
  // Mở đúng tab theo đường dẫn (#ketoan), tab đang xem, rồi trang mở đầu của vai trò
  const [h, sub] = location.hash.slice(1).split('/');
  if (sub) dmGroup = sub;
  show([h, tab, LANDING[ME.role]].find(n => n && canTab(n)) || (visible[0] && visible[0].dataset.tab));
}

async function initLogin() {
  try {
    const st = await api('admin?action=status');
    setEnv(st.db_missing ? 'missing' : st.live_db ? 'live' : 'mock');
    document.getElementById('boot-form').hidden = !st.needs_bootstrap;
    document.getElementById('login-form').hidden = st.needs_bootstrap;
    document.getElementById('demo-hint').hidden = st.live_db || st.db_missing;
    document.getElementById('db-missing').hidden = !st.db_missing;
    if (st.db_missing && st.diag) {
      const d = st.diag;
      const box = document.getElementById('db-missing');
      box.insertAdjacentHTML('beforeend', '<div style="margin-top:10px; padding-top:10px; border-top:1px solid #fecaca;"><b>Chẩn đoán tự động:</b><ul style="margin:6px 0 0 18px; padding:0;">' +
        (d.hints || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
        '<div class="hint" style="margin-top:6px; color:#7f1d1d;">Biến SUPABASE bản deploy nhận được: ' + (d.supabase_vars.length ? d.supabase_vars.map(esc).join(', ') : '(không có)') +
        ' · môi trường: ' + esc(d.vercel_env || '—') + (d.db_mode ? ' · DB_MODE=' + esc(d.db_mode) : '') +
        ' · biến cấu hình khác: ' + esc(d.own_vars || '—') + (d.deploy && d.deploy.commit ? ' · bản deploy commit ' + esc(d.deploy.commit) + ' (' + esc(d.deploy.branch || '') + ')' : '') + '</div></div>');
    }
    if (st.schema_missing && st.schema_missing.length) {
      const box = document.getElementById('db-missing');
      box.hidden = false;
      box.innerHTML = '<b>Database còn thiếu bảng / cột của ' + st.schema_missing.length + ' migration</b> – một số trang (suất chiếu, banner, đánh giá…) sẽ báo lỗi cho tới khi chạy xong.' +
        '<ul style="margin:6px 0 0 18px; padding:0;">' + st.schema_missing.map(m => '<li><code>migrations/' + esc(m.file) + '</code>: ' + m.items.map(esc).join(', ') + '</li>').join('') + '</ul>' +
        '<div class="hint" style="margin-top:6px; color:#7f1d1d;">' + esc(st.schema_hint || '') + '</div>';
    }
    if (st.db_missing) { setEnv('missing'); document.getElementById('login-form').hidden = true; document.getElementById('boot-form').hidden = true; }
  } catch (e) {}
}

function show(name) {
  if (!canTab(name)) return;
  if (tab === 'quay' && name !== 'quay') { stopCamera(); exitKiosk(); }
  const changed = tab !== name;
  tab = name;
  document.querySelectorAll('#tabs button[data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ['tongquan', 'cskh', 'ketoan', 'danhmuc', 'quay', 'it', 'nhansu'].forEach(n => { document.getElementById('tab-' + n).hidden = n !== name; });
  document.getElementById('page-title').textContent = TAB_TITLE[name] || '';
  document.documentElement.classList.toggle('dm-open', name === 'danhmuc');
  document.title = (TAB_TITLE[name] || 'Quản trị') + ' · Beta Cinemas';
  // Đường dẫn chia sẻ được: admin.html#ketoan, admin.html#danhmuc/lich-chieu
  const h = '#' + name + (name === 'danhmuc' && dmGroup ? '/' + dmGroup : '');
  if (location.hash !== h) history.replaceState(null, '', h);
  toggleNav(false);
  if (changed) window.scrollTo(0, 0);
  if (name === 'ketoan') { if (can('report.view') && !document.getElementById('r-table').innerHTML) loadReport(); if (overview) { ktHeavyAt = 0; renderKetoan(); } }
  if (name === 'cskh') { loadReviews(); loadEvents(); }
  if (name === 'it') { loadSystem(); loadHealthLights(); }
  if (name === 'nhansu') loadStaff().catch(e => toast('Không tải được danh sách nhân viên: ' + e.message, 'danger'));
  if (name === 'danhmuc') { dmShow(dmGroup || 'lich-chieu'); loadCatalog().catch(e => toast('Không tải được danh mục: ' + e.message, 'danger')); }
  if (name === 'tongquan') loadDashboard();
  if (name === 'quay') initCounter();
}
document.querySelectorAll('#tabs button[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
window.addEventListener('hashchange', () => {
  if (!ME) return;
  const [h, sub] = location.hash.slice(1).split('/');
  if (h === 'danhmuc' && sub && sub !== dmGroup) { dmGroup = sub; if (tab === 'danhmuc') dmShow(sub); }
  if (h && h !== tab) show(h);
});

let loadSeq = 0;
async function load(auto) {
  if (!can('refund.view')) return; // Nhân viên quầy chỉ dùng tra cứu
  const seq = ++loadSeq;
  const o = await api('admin?action=overview');
  if (seq !== loadSeq || (auto && acting)) return; // có lượt tải mới hơn / đang thao tác: bỏ kết quả cũ
  overview = o;
  setEnv(overview.live_db ? 'live' : 'mock');
  renderCskh(); renderKetoan(); if (isManager()) renderIt();
  if (tab === 'tongquan') renderDbTodo();
}

// ---------------- TỔNG QUAN ----------------
const shortVnd = (n) => n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' tỷ' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' tr' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
const pctTxt = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
const numTxt = (n) => (Number(n) || 0).toLocaleString('vi-VN');
function hbars(rows, valueKey, label) {
  if (!rows.length) return '<div class="empty">Chưa có dữ liệu trong kỳ.</div>';
  const top = rows.slice(0, 8);
  const other = rows.slice(8).reduce((s, r) => s + r[valueKey], 0);
  if (other) top.push({ [label]: 'Khác (' + (rows.length - 8) + ')', [valueKey]: other, tickets: rows.slice(8).reduce((s, r) => s + r.tickets, 0) });
  const max = Math.max(...top.map(r => r[valueKey]), 1);
  return top.map(r => `<div class="hbar" title="${esc(r[label])}: ${vnd(r[valueKey])} · ${r.tickets} vé">
        <span class="name">${esc(r[label])}</span><span class="track"><i style="width: ${(r[valueKey] / max * 100).toFixed(1)}%"></i></span><span class="v">${shortVnd(r[valueKey])}</span></div>`).join('');
}
// Tải báo cáo CSV (mở bằng Excel). Dùng fetch kèm token rồi lưu file, vì link thường không gửi được Authorization.
async function downloadDashboard() {
  try {
    const f = val('db-from'), tt = val('db-to');
    const r = await fetch(API + 'admin?action=dashboard&format=csv' + (f ? '&from=' + f : '') + (tt ? '&to=' + tt : ''), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'bao-cao-quan-ly.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast('Không xuất được báo cáo: ' + e.message, 'danger'); }
}

// Chọn nhanh khoảng ngày (theo giờ Việt Nam); p = null: người dùng tự nhập ngày → bỏ đánh dấu nút
const dbToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const dbAddDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function dbPreset(p) {
  document.querySelectorAll('#db-presets .chip').forEach(c => { const on = p != null && c.dataset.p === String(p); c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  if (p == null) return;
  const to = dbToday();
  const from = p === 'month' ? to.slice(0, 8) + '01' : p === 'today' ? to : dbAddDays(to, 1 - Number(p));
  document.getElementById('db-from').value = from;
  document.getElementById('db-to').value = to;
  loadDashboard();
}

// Việc đang tồn của từng bộ phận (lấy từ dữ liệu tổng quan đã tải; chưa có thì dùng số của báo cáo)
let DB_K = null;
function renderDbTodo() {
  const box = document.getElementById('db-todo');
  if (!box) return;
  const o = overview, k = DB_K || {};
  const rf = o ? o.refunds : null;
  const items = [
    ['cskh', o ? o.tickets.filter(x => x.status === 'OPEN').length : k.open_tickets, 'Phiếu hỗ trợ chờ trả lời', 'Chăm sóc khách hàng'],
    ['cskh', rf ? rf.filter(r => r.status === 'FORM_SUBMITTED').length : null, 'Hồ sơ hoàn tiền cần đối chiếu', 'Chăm sóc khách hàng'],
    ['cskh', rf ? rf.filter(r => r.status === 'ACC_RETURNED').length : null, 'Kế toán trả về', 'Chăm sóc khách hàng'],
    ['ketoan', rf ? rf.filter(r => r.status === 'CS_APPROVED').length : null, 'Hồ sơ chờ chi tiền', 'Kế toán'],
    ['it', o && o.alerts ? o.alerts.filter(a => a.level === 'danger').length : null, 'Cảnh báo hệ thống', 'IT / Vận hành']
  ].filter(([tb, n]) => n != null && canTab(tb));
  box.hidden = !items.length;
  box.innerHTML = items.map(([tb, n, title, sub]) => `<button type="button" class="${n ? 'hot' : 'zero'}" data-on-click="show('${tb}')"><span class="n">${numTxt(n)}</span><span class="t">${title}<small>${sub} ›</small></span></button>`).join('');
}

let dbSeq = 0;
async function loadDashboard() {
  const f = document.getElementById('db-from'), tt = document.getElementById('db-to');
  if (f.value && tt.value && f.value > tt.value) { toast('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc', 'warn'); return; }
  const seq = ++dbSeq;
  const kp = document.getElementById('db-kpis');
  if (!kp.children.length) kp.innerHTML = '<div class="loading">Đang tải số liệu…</div>';
  kp.setAttribute('aria-busy', 'true');
  let d;
  const sentF = f.value, sentT = tt.value; // ngày người dùng đổi trong lúc chờ thì giữ nguyên
  try { d = await api('admin?action=dashboard' + (f.value ? '&from=' + f.value : '') + (tt.value ? '&to=' + tt.value : '')); }
  catch (e) {
    if (seq !== dbSeq) return;
    kp.removeAttribute('aria-busy');
    kp.innerHTML = `<div class="alert danger" style="grid-column: 1 / -1;">Không tải được số liệu: ${esc(e.message)} <button type="button" class="btn" data-on-click="loadDashboard()">Thử lại</button></div>`;
    return;
  }
  if (seq !== dbSeq) return; // đã chọn kỳ khác trong lúc chờ
  kp.removeAttribute('aria-busy');
  if (f.value === sentF) f.value = d.from;
  if (tt.value === sentT) tt.value = d.to;
  const k = d.kpi, p = d.kpi_prev || {};
  DB_K = k;
  renderDbTodo();
  const nDays = d.days.length;
  const delta = (cur, prev, money) => {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (!prev && !cur) return '<span class="delta same">bằng kỳ trước</span>';
    if (!prev) return '<span class="delta up">▲ kỳ trước chưa có</span>';
    const pc = Math.round((cur - prev) / prev * 1000) / 10;
    const cls = pc > 0 ? 'up' : pc < 0 ? 'down' : 'same';
    return `<span class="delta ${cls}" title="Cùng khoảng thời gian (tính tới giờ hiện tại) của ${nDays} ngày liền trước: ${money ? vnd(prev) : numTxt(prev)}">${pc > 0 ? '▲' : pc < 0 ? '▼' : '='} ${pctTxt(Math.abs(pc))} so với kỳ trước</span>`;
  };
  kp.innerHTML = [
    [vnd(k.revenue), 'Doanh thu (vé + bắp nước)', delta(k.revenue, p.revenue, true)],
    [vnd(k.net), 'Doanh thu thuần (trừ tiền hoàn do hủy / sự cố)', k.reversal ? `<span class="delta same">đã trừ ${vnd(k.reversal)}</span>` : ''],
    [numTxt(k.tickets), 'Vé đã bán', delta(k.tickets, p.tickets)],
    [numTxt(k.orders), 'Đơn đã xuất vé', delta(k.orders, p.orders)]
  ].map(([v, l, extra]) => `<div class="kpi"><b>${v}</b><span>${l}</span>${extra ? '<div>' + extra + '</div>' : ''}</div>`).join('');
  document.getElementById('db-kpis2').innerHTML = [
    [vnd(k.avg_order), 'Giá trị trung bình mỗi đơn'],
    [pctTxt(k.occupancy_period), 'Lấp đầy các suất đã chiếu trong kỳ' + (d.occupancy_from && (d.occupancy_from !== d.from || d.occupancy_to !== d.to) ? ' (' + d.occupancy_from.split('-').reverse().slice(0, 2).join('/') + '–' + d.occupancy_to.split('-').reverse().slice(0, 2).join('/') + ')' : '')],
    [pctTxt(k.occupancy_3d), 'Lấp đầy ghế 3 ngày tới'],
    [vnd(k.refunded), 'Đã hoàn cho khách (không tính vào doanh thu)'],
    [pctTxt(k.refund_rate), 'Tỷ lệ tiền phải hoàn (trên tổng tiền nhận)']
  ].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

  // Biểu đồ cột: nhãn số trên cột (≤ 16 ngày), 2 đường mốc, tổng / trung bình ở tiêu đề
  const max = Math.max(...d.days.map(x => x.revenue), 1);
  const total = d.days.reduce((s, x) => s + x.revenue, 0);
  const every = Math.ceil(nDays / 14);
  const showVal = nDays <= 16;
  document.getElementById('db-days-sum').textContent = `tổng ${vnd(total)} · trung bình ${vnd(Math.round(total / Math.max(nDays, 1)))}/ngày`;
  document.getElementById('db-days').innerHTML = `
        <div class="chart-cols" role="img" aria-label="Doanh thu theo ngày từ ${d.from} đến ${d.to}, tổng ${vnd(total)}">
          ${total ? `<div class="gridline" style="bottom: calc((100% - 22px) * 1);"><span>${shortVnd(max)}</span></div><div class="gridline" style="bottom: calc((100% - 22px) * .5);"><span>${shortVnd(max / 2)}</span></div>` : ''}
          ${d.days.map(x => { const h = x.revenue / max * 100; return `
          <div class="col"><i style="height: ${h.toFixed(1)}%"></i>${showVal && x.revenue ? `<span class="val" style="bottom: calc(${h.toFixed(1)}% + 2px);">${shortVnd(x.revenue)}</span>` : ''}
            <span class="tip">${x.date.split('-').reverse().join('/')}<br><b>${vnd(x.revenue)}</b> · ${x.orders} đơn · ${x.tickets} vé</span></div>`; }).join('')}
        </div>
        <div class="chart-x" aria-hidden="true">${d.days.map((x, i) => `<span>${i % every === 0 ? x.date.slice(8) + '/' + x.date.slice(5, 7) : ''}</span>`).join('')}</div>
        ${total ? '' : '<div class="hint" style="margin-top: 8px;">Chưa có đơn nào được xuất vé trong kỳ này.</div>'}
        <details class="table-view"><summary>Xem dạng bảng</summary>
          <table><thead><tr><th>Ngày</th><th>Doanh thu</th><th>Đơn</th><th>Vé</th></tr></thead><tbody>${
        d.days.map(x => `<tr><td>${x.date.split('-').reverse().join('/')}</td><td>${vnd(x.revenue)}</td><td>${x.orders}</td><td>${x.tickets}</td></tr>`).join('')}</tbody></table>
        </details>`;
  document.getElementById('db-movies').innerHTML = hbars(d.by_movie, 'revenue', 'title');
  document.getElementById('db-cinemas').innerHTML = hbars(d.by_cinema, 'revenue', 'name');
  document.getElementById('db-slots').innerHTML = hbars(d.by_slot, 'revenue', 'label');
  const tbl = (head, rows, empty) => rows.length ? `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<div class="empty">${empty}</div>`;
  const m = d.mix;
  document.getElementById('db-mix').innerHTML = tbl(['Hạng mục', 'Số tiền'], [
    ['Vé', vnd(m.ticket)], ['Bắp nước kèm vé', vnd(m.fnb_with_ticket)], ['Bắp nước mua riêng', vnd(m.fnb_only)],
    ['Giảm do voucher', '−' + vnd(m.discount)], ['Trả bằng điểm Beta Club', '−' + vnd(m.points)]], '');
  document.getElementById('db-occ').innerHTML = tbl(['Phim', 'Suất', 'Ghế bán', 'Lấp đầy'], d.occupancy_by_movie.map(x => [esc(x.title), x.shows, x.sold + '/' + x.total, pctTxt(x.rate)]), 'Chưa có suất nào đã chiếu trong kỳ.');
  document.getElementById('db-vouchers').innerHTML = tbl(['Mã', 'Lượt', 'Tổng giảm', 'Doanh thu kèm mã'], d.vouchers.map(x => [`<span class="mono">${esc(x.code)}</span>`, x.uses, vnd(x.discount), vnd(x.revenue)]), 'Chưa có đơn dùng voucher.');
  document.getElementById('db-refunds').innerHTML = tbl(['Lý do', 'Hồ sơ', 'Số tiền'], d.refunds_by_reason.map(x => [esc(x.label), x.count, vnd(x.amount)]), 'Không có khoản hoàn tiền nào trong kỳ.');
  const lo = d.loyalty;
  document.getElementById('db-loyalty').innerHTML = tbl(['Hạng mục', 'Điểm', 'Quy ra tiền'], [['Tích từ đơn', lo.earned], ['Quà sinh nhật', lo.birthday], ['Đã dùng', lo.redeemed], ['Hết hạn', lo.expired]].map(([a, b]) => [a, numTxt(b), vnd(b * 1000)]), '');
  // Suất 3 ngày tới: 8 suất đầu, phần còn lại thu gọn
  const upHead = '<thead><tr><th>Suất</th><th>Phim</th><th>Rạp</th><th style="width: 34%;">Lấp đầy</th></tr></thead>';
  const upRow = (x) => `<tr><td><b>${esc(x.time)}</b> <span class="hint">${esc(x.date_label)}</span></td><td>${esc(x.movie)}</td><td>${esc(x.cinema)}</td>
          <td><div class="hbar" style="grid-template-columns: 1fr auto; padding: 0;"><span class="track"><i style="width: ${Math.max(x.rate, 0.5)}%"></i></span><span class="v">${x.sold}/${x.total} · ${pctTxt(x.rate)}</span></div></td></tr>`;
  const up = d.upcoming;
  document.getElementById('db-up-sub').textContent = d.upcoming_total > up.length ? `${up.length}/${d.upcoming_total} suất bán chạy nhất` : 'bán chạy nhất trước';
  document.getElementById('db-upcoming').innerHTML = up.length
    ? `<table>${upHead}<tbody>${up.slice(0, 8).map(upRow).join('')}</tbody></table>` + (up.length > 8 ? `<details class="table-view"><summary>Xem thêm ${up.length - 8} suất</summary><table>${upHead}<tbody>${up.slice(8).map(upRow).join('')}</tbody></table></details>` : '')
    : '<div class="empty">Chưa có suất chiếu nào trong 3 ngày tới.</div>';
}

// ---------------- QUẦY: SOÁT VÉ (Đợt 11) ----------------
// Kết quả phân biệt bằng màu + chữ + âm + rung: hợp lệ / đã soát / vé rạp khác / chưa tới giờ / không hợp lệ / lỗi kết nối.
// Camera không gửi lại cùng một mã trong 20 giây; cùng một mã đang chờ máy chủ thì không gửi trùng.
// Quét dồn dập (máy quét USB): các lượt chạy song song nhưng CHỈ lượt mới nhất được vẽ khung kết quả và phát âm;
// lượt cũ vẫn vào lịch sử (theo giờ quét), bị từ chối thì có thêm một dòng thông báo.
let ckHistory = [];
try { ckHistory = JSON.parse(sessionStorage.getItem('beta_ck_hist') || '[]').map(h => ({ ...h, at: new Date(h.at) })); } catch (e) { ckHistory = []; }
const ckRecent = new Map();      // camera: mã → lúc có kết quả gần nhất (bỏ qua cùng mã trong 20 giây)
const ckInflight = new Set();    // mã đang chờ máy chủ trả lời (máy quét đọc 2 lần / bấm Enter 2 lần)
const ckOkAt = new Map();        // mã → lúc soát HỢP LỆ tại quầy này (giải thích khi quét lại ngay)
const ckRetryAt = new Map();     // mã → lúc gặp lỗi kết nối (lượt đó có thể đã được ghi nhận trên máy chủ)
let ckBusy = false, ckSeq = 0;
const CK_HEAD = {
  ok: '<i class="ph-check-circle" aria-hidden="true"></i> HỢP LỆ – MỜI VÀO',
  used: '<i class="ph-x-circle" aria-hidden="true"></i> KHÔNG HỢP LỆ – VÉ ĐÃ ĐƯỢC SOÁT',
  other: '<i class="ph-warning" aria-hidden="true"></i> VÉ CỦA RẠP KHÁC',
  wait: '<i class="ph-clock" aria-hidden="true"></i> CHƯA TỚI GIỜ VÀO',
  bad: '<i class="ph-x-circle" aria-hidden="true"></i> KHÔNG HỢP LỆ',
  retry: '<i class="ph-warning" aria-hidden="true"></i> CHƯA KIỂM TRA ĐƯỢC – QUÉT LẠI'
};
const CK_LABEL = { ok: ['Vào', 'ok'], used: ['Đã soát trước đó', 'danger'], other: ['Rạp khác', 'warn'], wait: ['Chưa tới giờ', 'warn'], bad: ['Từ chối', 'danger'], retry: ['Lỗi kết nối', 'warn'] };
const ckTime = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });
async function doCheckin(raw, opts = {}) {
  raw = String(raw || '').trim();
  if (!raw) return;
  const box = document.getElementById('ck-result');
  const input = document.getElementById('ck-input');
  input.value = '';
  // Chưa có rạp làm việc (vd không tải được danh sách rạp): không soát, vì máy chủ sẽ bỏ qua bước chặn "vé của rạp khác"
  if (!val('qc-cinema')) {
    box.innerHTML = `<div class="ck ck-bad"><div class="ck-head">${CK_HEAD.bad}</div><div class="ck-msg">Chưa có rạp làm việc nên vé CHƯA được soát. Đang tải lại danh sách rạp – chọn rạp rồi quét lại.</div></div>`;
    beep(false);
    initCounter();
    return;
  }
  if (ckInflight.has(raw) && !opts.force) return;
  ckInflight.add(raw);
  const seq = ++ckSeq, at = new Date();
  // Máy tính (máy quét USB): giữ con trỏ ở ô quét; điện thoại: không bật bàn phím che kết quả
  if (window.matchMedia('(pointer: fine)').matches) input.focus();
  unlockAudio();
  box.innerHTML = `<div class="ck ck-checking"><div class="ck-head">Đang kiểm tra vé…</div><div class="ck-msg mono" style="font-weight: 600;">${esc(raw.slice(0, 28))}</div></div>`;
  let ok = false, data = null, msg = '', status = 0;
  try {
    data = await api('admin', { method: 'POST', body: JSON.stringify({ action: 'checkin', qr: raw, cinema_id: val('qc-cinema') || undefined, force: opts.force === true ? true : undefined }),
      signal: window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
    ok = true;
  } catch (e) { msg = e.message || ''; data = e.data || null; status = e.status || 0; }
  finally { ckInflight.delete(raw); }
  const sm = data && data.summary;
  // Mất mạng / quá 12 giây / máy chủ lỗi 5xx: KHÔNG phải vé hỏng -> báo quét lại, không nói "không hợp lệ"
  const retry = !ok && !sm && (!status || status >= 500);
  const kind = ok ? 'ok' : retry ? 'retry' : data && data.already ? 'used' : data && data.wrong_cinema ? 'other' : /Chưa đến giờ/i.test(msg) ? 'wait' : 'bad';
  if (kind === 'other') msg = msg.replace(/^VÉ CỦA RẠP KHÁC:\s*/i, 'Vé của rạp ');
  if (kind === 'retry') msg = 'Máy chủ chưa trả lời (' + (status ? 'lỗi ' + status : 'mất kết nối hoặc quá lâu') + ') – vé CHƯA bị từ chối, hãy quét lại.';
  if (ok) ckOkAt.set(raw, Date.now());
  if (kind === 'retry') ckRetryAt.set(raw, Date.now());
  // Camera: tính lại 20 giây kể từ lúc có kết quả (kể cả lượt "vẫn cho vào"); lỗi kết nối thì cho quét lại sau ~3 giây
  ckRecent.set(raw, kind === 'retry' ? Date.now() - 17000 : Date.now());
  ckHistory.unshift({ at, kind, code: sm ? sm.code : raw.slice(0, 20), seats: sm ? (sm.kind === 'FNB' ? 'Bắp nước' : (sm.seats || []).join(', ')) : '', room: sm ? sm.room || '' : '' });
  ckHistory = ckHistory.slice(0, 30);
  try { sessionStorage.setItem('beta_ck_hist', JSON.stringify(ckHistory)); } catch (e) {}
  renderCkHistory();
  loadCounterBoard();
  // Đã có lượt quét mới hơn: không vẽ đè khung kết quả, không phát âm cho lượt cũ
  if (seq !== ckSeq) {
    if (!ok) toast('Lượt quét trước (' + (sm ? sm.code : raw.slice(0, 14)) + '): ' + CK_LABEL[kind][0] + (kind === 'retry' ? ' – quét lại' : ''), 'warn', 8000);
    return;
  }
  const items = sm && (sm.items || []).length ? sm.items.map(x => esc(x.qty + ' × ' + x.name)).join(', ') : '';
  const body = sm ? `<div class="ck-body">
          ${sm.kind === 'FNB'
        ? `<div><b>PHIẾU BẮP NƯỚC</b> · ${esc(sm.cinema || '')}</div><div>Giao: <span class="ck-big">${items}</span></div>`
        : `${sm.movie_title ? `<div><b>${esc(sm.movie_title)}</b></div>` : ''}
               <div>${esc(sm.cinema || '')}${sm.room ? ' · <b>' + esc(sm.room) + '</b>' : ''} · <b>${esc(sm.show_time || '')}</b> ${esc(sm.show_date || '')}</div>
               <div>Ghế: <span class="ck-big">${esc((sm.seats || []).join(', '))}</span></div>
               ${items ? `<div>Kèm bắp nước: <b>${items}</b> – giao tại quầy bắp</div>` : ''}`}
          <div style="font-size: 13px; margin-top: 4px;">Đơn <span class="mono">${esc(sm.code)}</span>${sm.signed ? '' : ' · soát bằng mã đơn (nhập tay)'}${sm.customer_name ? ' · ' + esc(sm.customer_name) : ''}</div>
          ${(sm.special || []).length ? `<div class="ck-special"><i class="ph-warning" aria-hidden="true"></i> Kiểm tra giấy tờ: ${sm.special.map(x => esc(x.seat + ' – ' + x.label)).join(', ')}</div>` : ''}
        </div>` : '';
  const okBefore = kind === 'used' ? ckOkAt.get(raw) : null;
  const errBefore = kind === 'used' ? ckRetryAt.get(raw) : null;
  const repeat = okBefore && Date.now() - okBefore < 120000
    ? `<div class="ck-repeat">Mã này vừa soát HỢP LỆ tại quầy này lúc ${ckTime(okBefore)}. Nếu vẫn là cùng một khách (máy quét đọc 2 lần) thì mời vào; người khác cầm cùng mã thì từ chối.</div>`
    : errBefore && Date.now() - errBefore < 120000
      ? `<div class="ck-repeat">Lần quét mã này lúc ${ckTime(errBefore)} bị lỗi kết nối nên có thể đã được ghi nhận. Nếu giờ soát và tên nhân viên ở trên là của quầy này thì mời vào.</div>` : '';
  // Nút "Vẫn cho vào" gắn đúng mã của khung kết quả này (không dùng biến chung của lượt quét sau)
  const actions = kind === 'other' ? `<div class="ck-actions"><button type="button" class="btn" data-raw="${esc(raw)}" data-on-click="doCheckin(this.dataset.raw, { force: true })"><i class="ph-check" aria-hidden="true"></i> Vẫn cho vào (ghi nhận ngoại lệ)</button></div>` : '';
  box.innerHTML = `<div class="ck ck-${kind}"><div class="ck-head">${CK_HEAD[kind]}</div>${msg ? `<div class="ck-msg">${esc(msg)}</div>` : ''}${data && data.forced ? '<div class="ck-msg">Đã cho vào dù vé của rạp khác – đã ghi vào nhật ký thao tác.</div>' : ''}${repeat}${body}${actions}</div>`;
  try { if (navigator.vibrate) navigator.vibrate(ok ? 90 : ['other', 'wait', 'retry'].includes(kind) ? [60, 50, 60] : [120, 70, 120]); } catch (e) {}
  if (kind !== 'retry') beep(ok);
}
function renderCkHistory() {
  const box = document.getElementById('ck-history');
  if (!ckHistory.length) { box.innerHTML = 'Chưa soát vé nào trong ca này. Đưa mã vạch vào ô phía trên để bắt đầu.'; return; }
  box.innerHTML = '<table><thead><tr><th>Giờ</th><th>Mã đơn</th><th>Ghế / phòng</th><th>Kết quả</th></tr></thead><tbody>' + ckHistory.slice(0, document.body.classList.contains('kiosk') ? 5 : 12).map(h =>
    `<tr><td>${h.at.toLocaleTimeString('vi-VN', { hour12: false })}</td><td class="mono">${esc(h.code)}</td><td>${esc(h.seats)}${h.room ? ' · ' + esc(h.room) : ''}</td><td>${pill(...(CK_LABEL[h.kind] || CK_LABEL.bad))}</td></tr>`).join('') + '</tbody></table>';
}

// Âm báo: 1 tiếng cao = hợp lệ, 2 tiếng trầm = từ chối. Chrome Android chỉ cho phát âm thanh sau một lần chạm,
// nên "mở khóa" âm thanh ngay lần chạm / phím đầu tiên (trước đây quét bằng camera có thể không kêu).
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* trình duyệt không hỗ trợ */ }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
function beep(ok) {
  if (!document.getElementById('qc-sound') || !document.getElementById('qc-sound').checked) return;
  try {
    unlockAudio();
    const tone = (freq, at, dur) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(0.25, audioCtx.currentTime + at); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + at + dur); o.connect(g); g.connect(audioCtx.destination); o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + dur); };
    if (ok) tone(1046, 0, 0.18); else { tone(330, 0, 0.16); tone(262, 0.2, 0.22); }
  } catch (e) { /* trình duyệt chặn âm thanh: bỏ qua */ }
}

// Chế độ quầy: ẩn menu và phần không cần, toàn màn hình (nếu được), giữ màn hình sáng
let wakeLock = null;
async function enterKiosk() {
  document.body.classList.add('kiosk');
  unlockAudio();
  renderCkHistory();
  try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (e) { /* iPhone / app không hỗ trợ */ }
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  setTimeout(() => { if (window.matchMedia('(pointer: fine)').matches) document.getElementById('ck-input').focus(); }, 200);
}
function exitKiosk() {
  if (!document.body.classList.contains('kiosk')) return;
  document.body.classList.remove('kiosk');
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  wakeLock = null;
  renderCkHistory();
}
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && document.body.classList.contains('kiosk') && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
});

async function initCounter() {
  const sel = document.getElementById('qc-cinema');
  try { document.getElementById('qc-sound').checked = localStorage.getItem('beta_qc_sound') !== '0'; } catch (e) {}
  if (!sel.options.length) {
    try {
      const r = await api('catalog?action=cinemas');
      let saved = null; try { saved = localStorage.getItem('beta_qc_cinema'); } catch (e) {}
      sel.innerHTML = r.cinemas.map(c => `<option value="${esc(c.id)}" ${c.id === saved ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    } catch (e) {
      // Không im lặng: thiếu rạp làm việc thì không soát được (xem doCheckin)
      document.getElementById('qc-board').innerHTML = `<div class="alert danger">Không tải được danh sách rạp: ${esc(e.message)} <button type="button" class="btn" data-on-click="initCounter()">Thử lại</button></div>`;
    }
  }
  renderCkHistory();
  if (window.matchMedia('(pointer: fine)').matches) setTimeout(() => document.getElementById('ck-input').focus(), 50);
  await loadCounterBoard();
}
function saveCounterCinema() {
  try { localStorage.setItem('beta_qc_cinema', val('qc-cinema')); } catch (e) {}
  document.getElementById('ck-result').innerHTML = ''; // bỏ kết quả (và nút "Vẫn cho vào") của rạp cũ
  loadCounterBoard();
  toast('Rạp làm việc: ' + (document.getElementById('qc-cinema').selectedOptions[0] || {}).textContent, 'info');
}
let qcSeq = 0;
async function loadCounterBoard() {
  if (!document.getElementById('qc-cinema') || !val('qc-cinema')) return;
  const seq = ++qcSeq; // đổi rạp / làm mới chồng nhau: chỉ vẽ kết quả của lượt mới nhất
  try {
    const d = await api('admin?action=counter_board&cinema=' + encodeURIComponent(val('qc-cinema')));
    if (seq !== qcSeq) return;
    document.getElementById('qc-mine').textContent = 'Ca của tôi: ' + d.my_checkins_today + ' vé đã soát hôm nay';
    document.getElementById('qc-sub').textContent = `${d.cinema.name} · ${d.date.split('-').reverse().join('/')} · đã vào ${d.totals.checked_seats}/${d.totals.sold_seats} ghế đã bán · tự cập nhật 30 giây/lần`;
    const PH = { SOON: pill('Sắp chiếu ≤ 30 phút', 'warn'), PLAYING: pill('Đang chiếu', 'info'), ENDED: pill('Đã chiếu', 'muted'), LATER: pill('Chưa tới giờ', 'muted') };
    // Suất sắp chiếu / đang chiếu lên đầu; suất đã chiếu gom vào mục thu gọn
    const ORDER = { SOON: 0, PLAYING: 1, LATER: 2, ENDED: 3 };
    const rows = d.showtimes.slice().sort((a, b) => (ORDER[a.phase] - ORDER[b.phase]) || String(a.time).localeCompare(String(b.time)));
    const live = rows.filter(s => s.phase !== 'ENDED'), past = rows.filter(s => s.phase === 'ENDED');
    const table = (list) => `<table><thead><tr><th>Giờ</th><th>Phim</th><th>Phòng</th><th style="width: 32%;">Đã vào / đã bán</th><th>Trạng thái</th></tr></thead><tbody>${
      list.map(s => { const rate = s.sold_seats ? Math.round(s.checked_seats / s.sold_seats * 100) : 0; return `<tr class="${s.phase === 'ENDED' ? 'inactive' : ''}" style="${s.phase === 'SOON' ? 'background: #fffbeb;' : ''}">
            <td><b style="font-size: 15px;">${esc(s.time)}</b><div class="hint">→ ${esc(s.end_time || '')}</div></td><td>${esc(s.movie)}<div class="hint">${esc(s.format || '')}</div></td><td>${esc(s.room || '')}</td>
            <td><div class="hbar" style="grid-template-columns: 1fr auto; padding: 0;"><span class="track"><i style="width: ${Math.max(rate, 0.5)}%"></i></span><span class="v">${s.checked_seats}/${s.sold_seats} ghế</span></div><div class="hint">${s.sold_seats}/${s.seats_total} ghế đã bán · ${s.orders} đơn</div></td>
            <td>${s.active ? PH[s.phase] : pill('Ngừng bán', 'danger')}</td></tr>`; }).join('')}</tbody></table>`;
    document.getElementById('qc-board').innerHTML = !rows.length ? '<div class="empty">Rạp không có suất chiếu hôm nay.</div>'
      : (live.length ? table(live) : '<div class="empty">Đã hết suất chiếu trong hôm nay.</div>') + (past.length ? `<details class="board-past"><summary>Đã chiếu (${past.length} suất)</summary>${table(past)}</details>` : '');
    document.getElementById('qc-pickups').innerHTML = d.pickups.length ? `<table><thead><tr><th>Mã đơn</th><th>Khách</th><th>Món</th><th>Thanh toán lúc</th><th></th></tr></thead><tbody>${
      d.pickups.map(p => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.customer)}</td><td><b>${esc(p.items)}</b></td><td>${t(p.paid_at)}</td><td><button type="button" class="btn ok" data-code="${esc(p.code)}" data-on-click="doCheckin(this.dataset.code)"><i class="ph-popcorn" aria-hidden="true"></i> Giao món</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Không có phiếu bắp nước nào chờ nhận.</div>';
  } catch (e) { if (seq === qcSeq) document.getElementById('qc-board').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
setInterval(() => { if (TOKEN && ME && tab === 'quay' && !document.hidden) loadCounterBoard(); }, 30000);

// Quét mã vạch vé (Code 128) hoặc QR cũ bằng camera (BarcodeDetector: Chrome Android, macOS, ChromeOS).
// camGen: mỗi lần mở / tắt tăng 1 – lượt mở camera đang chờ quyền mà người dùng đã tắt / rời tab thì tự hủy.
let camStream = null, camTimer = null, camGen = 0, camStarting = false;
function stopCamera() {
  camGen++; camStarting = false;
  clearInterval(camTimer); camTimer = null;
  if (!camStream) return;
  camStream.getTracks().forEach(tr => tr.stop());
  camStream = null;
  const video = document.getElementById('ck-video');
  video.hidden = true; video.srcObject = null;
  document.getElementById('ck-cam-btn').innerHTML = '<i class="ph-camera" aria-hidden="true"></i> Quét bằng camera';
}
async function toggleCamera() {
  const video = document.getElementById('ck-video');
  const hint = document.getElementById('ck-cam-hint');
  if (camStream) { stopCamera(); hint.textContent = ''; return; }
  if (camStarting) return; // bấm 2 lần khi camera đang mở: bỏ qua
  unlockAudio();
  if (!('BarcodeDetector' in window)) { hint.textContent = 'Trình duyệt này chưa quét được mã bằng camera (cần Chrome trên Android) – hãy dùng máy quét mã vạch USB hoặc nhập mã đơn.'; return; }
  const gen = ++camGen; camStarting = true; hint.textContent = 'Đang mở camera…';
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (gen !== camGen) { stream.getTracks().forEach(tr => tr.stop()); return; }
    camStream = stream; video.srcObject = stream; video.hidden = false; await video.play();
    if (gen !== camGen) return;
    hint.textContent = 'Đưa mã vạch trên vé vào khung hình.';
    document.getElementById('ck-cam-btn').innerHTML = '<i class="ph-stop" aria-hidden="true"></i> Tắt camera';
    let formats = ['code_128', 'qr_code'];
    try { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(f => sup.includes(f)); } catch (e) { /* dùng mặc định */ }
    if (gen !== camGen) return;
    const det = new BarcodeDetector({ formats });
    camTimer = setInterval(async () => {
      if (ckBusy || !camStream) return;
      try {
        const codes = await det.detect(video);
        const v = codes[0] && String(codes[0].rawValue || '').trim();
        if (!v) return;
        const last = ckRecent.get(v);
        if (last && Date.now() - last < 20000) return; // vé vừa quét: giữ nguyên kết quả đang hiện
        ckRecent.set(v, Date.now());
        ckBusy = true;
        try { await doCheckin(v); } finally { ckBusy = false; }
      } catch (e) { /* khung hình lỗi: bỏ qua */ }
    }, 350);
  } catch (e) {
    if (stream && stream !== camStream) stream.getTracks().forEach(tr => tr.stop());
    if (gen === camGen) { stopCamera(); hint.textContent = 'Không mở được camera: ' + e.message; }
  } finally { if (gen === camGen) camStarting = false; }
}

// ---------------- DANH MỤC (Quản lý) ----------------
let CAT = null;
const val = (id) => document.getElementById(id).value.trim();
// ---------- Bảng giá ----------
let PRICING = null;
const DOWS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
async function loadPricing() {
  PRICING = await api('admin?action=pricing');
  const prd = document.getElementById('pr-days');
  if (!prd.querySelector('.pr-day')) prd.innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<label style="display: inline-flex; gap: 3px; align-items: center;"><input type="checkbox" value="${d}" class="pr-day">${DOWS[d]}</label>`).join('');
  const daysText = (r) => (r.holiday ? 'Ngày lễ' + ((r.days || []).length ? ' + ' : '') : '') + ((r.days || []).length === 7 ? 'Mọi ngày' : (r.days || []).map(d => DOWS[d]).join(', '));
  document.getElementById('pr-rules').innerHTML = `<table><thead><tr><th>Quy tắc</th><th>Ngày</th><th>Giờ</th><th>Thường / VIP / Đôi</th><th>Ưu tiên</th><th></th></tr></thead><tbody>${
    PRICING.rules.map(r => `<tr class="${r.active === false ? 'inactive' : ''}"><td><b>${esc(r.name)}</b></td><td>${esc(daysText(r))}</td><td>${esc(r.start_time)}–${esc(r.end_time)}</td>
          <td>${[r.price_standard, r.price_vip, r.price_sweetbox].map(v => v ? vnd(v) : '—').join(' / ')}</td><td>${r.priority}</td>
          <td class="row-actions"><button class="btn" data-on-click="editRule('${r.id}')">Sửa</button><button class="btn danger" data-on-click="deleteRule('${r.id}')">Xóa</button></td></tr>`).join('')
  }</tbody></table><p class="hint">Giá mặc định khi không quy tắc nào khớp: ${vnd(PRICING.default_prices.standard)} / ${vnd(PRICING.default_prices.vip)} / ${vnd(PRICING.default_prices.sweetbox)}.</p>`;
  document.getElementById('tt-table').innerHTML = `<table><thead><tr><th>Loại vé</th><th>Giảm</th><th>Ghi chú (hiện cho khách & quầy)</th><th></th></tr></thead><tbody>${
    PRICING.ticket_types.map(t => `<tr class="${t.active === false ? 'inactive' : ''}"><td><input id="tt-label-${t.id}" value="${esc(t.label)}" style="width: 120px;"><div class="hint mono">${t.id}</div></td>
          <td>${t.id === 'ADULT' ? '—' : `<input id="tt-off-${t.id}" type="number" step="1000" min="0" value="${t.off}" style="width: 90px;">`}</td>
          <td><input id="tt-note-${t.id}" value="${esc(t.note || '')}" style="width: 100%;"></td>
          <td class="row-actions"><button class="btn" data-on-click="saveTicketType('${t.id}')">Lưu</button>${t.id === 'ADULT' ? '' : `<button class="btn ${t.active === false ? 'ok' : 'danger'}" data-on-click="saveTicketType('${t.id}', ${t.active === false})">${t.active === false ? 'Bật' : 'Tắt'}</button>`}</td></tr>`).join('')
  }</tbody></table>`;
  document.getElementById('hd-list').innerHTML = PRICING.holidays.length
    ? PRICING.holidays.map(h => `<span class="pill p-info" style="margin: 2px;">${h.id.split('-').reverse().join('/')} · ${esc(h.name)} <a href="#" data-on-click="deleteHoliday('${h.id}'); return false;" style="color: inherit; margin-left: 4px;">✕</a></span>`).join('')
    : 'Chưa khai báo ngày lễ nào – quy tắc "ngày lễ" chỉ áp dụng cho các ngày trong danh sách này.';
}
function resetRuleForm() {
  ['pr-id', 'pr-name', 'pr-p1', 'pr-p2', 'pr-p3'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pr-start').value = '00:00'; document.getElementById('pr-end').value = '24:00';
  document.getElementById('pr-priority').value = 20; document.getElementById('pr-holiday').value = 'false'; document.getElementById('pr-active').value = 'true';
  document.querySelectorAll('.pr-day').forEach(c => { c.checked = false; });
  markEditing('pr-form', '');
}
function editRule(id) {
  const r = PRICING.rules.find(x => x.id === id);
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  set('pr-id', r.id); set('pr-name', r.name); set('pr-start', r.start_time); set('pr-end', r.end_time); set('pr-priority', r.priority);
  set('pr-p1', r.price_standard); set('pr-p2', r.price_vip); set('pr-p3', r.price_sweetbox);
  set('pr-holiday', String(!!r.holiday)); set('pr-active', String(r.active !== false));
  document.querySelectorAll('.pr-day').forEach(c => { c.checked = (r.days || []).includes(Number(c.value)); });
  markEditing('pr-form', 'quy tắc "' + r.name + '"', resetRuleForm);
}
const savePriceRule = () => act(async () => {
  await post('price_rule_save', { id: val('pr-id') || undefined, name: val('pr-name'), days: [...document.querySelectorAll('.pr-day:checked')].map(c => Number(c.value)),
    holiday: val('pr-holiday') === 'true', start_time: val('pr-start'), end_time: val('pr-end'), priority: val('pr-priority'),
    price_standard: val('pr-p1'), price_vip: val('pr-p2'), price_sweetbox: val('pr-p3'), active: val('pr-active') === 'true' });
  resetRuleForm();
  await loadPricing();
}, 'Đã lưu quy tắc giá – áp dụng cho các suất chưa có giá riêng');
const deleteRule = (id) => act(async () => {
  if (!(await uiConfirm({ title: 'Xóa quy tắc giá này?', body: 'Các suất chưa có giá riêng sẽ tính lại theo các quy tắc còn lại.', confirmLabel: 'Xóa quy tắc', danger: true }))) return CANCEL;
  await post('price_rule_delete', { id }); if (val('pr-id') === String(id)) resetRuleForm(); await loadPricing();
}, 'Đã xóa quy tắc giá');
const saveTicketType = (id, toggleTo) => act(async () => {
  const t = PRICING.ticket_types.find(x => x.id === id);
  const offEl = document.getElementById('tt-off-' + id);
  await post('ticket_type_save', { id, label: val('tt-label-' + id), off: offEl ? offEl.value : 0, note: val('tt-note-' + id), sort: t.sort,
    active: toggleTo === undefined ? t.active !== false : toggleTo });
  await loadPricing();
}, 'Đã lưu loại vé');
const saveHoliday = () => act(async () => { await post('holiday_save', { date: val('hd-date'), name: val('hd-name') }); document.getElementById('hd-name').value = ''; await loadPricing(); }, 'Đã thêm ngày lễ');
const deleteHoliday = (date) => act(async () => {
  if (!(await uiConfirm({ title: 'Bỏ ngày lễ ' + date.split('-').reverse().join('/') + '?', body: 'Các quy tắc giá "ngày lễ" sẽ không áp dụng cho ngày này nữa.', confirmLabel: 'Bỏ ngày lễ', danger: true }))) return CANCEL;
  await post('holiday_delete', { date }); await loadPricing();
}, 'Đã bỏ ngày lễ');

// ---------- Tin tức & ưu đãi ----------
// ===== Đợt 10: tải ảnh lên (thu nhỏ trên trình duyệt trước khi gửi) =====
function shrinkImage(file, maxW, maxH) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let d = c.toDataURL('image/webp', 0.85);
      if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', 0.85);
      ok(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Không đọc được tệp ảnh (chỉ nhận JPG, PNG, WebP)')); };
    img.src = url;
  });
}
function uploadImage(inputId, kind, maxW, maxH) {
  const pick = document.createElement('input');
  pick.type = 'file'; pick.accept = 'image/jpeg,image/png,image/webp';
  pick.onchange = async () => {
    const file = pick.files && pick.files[0];
    if (!file) return;
    const btn = document.getElementById(inputId).parentElement.querySelector('.up-btn');
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Ảnh gốc quá lớn (tối đa 15 MB)');
      if (btn) { btn.disabled = true; btn.textContent = 'Đang tải…'; }
      const data = await shrinkImage(file, maxW, maxH);
      const r = await post('media_upload', { kind, data });
      document.getElementById(inputId).value = r.url;
      document.getElementById(inputId).dispatchEvent(new Event('input'));
    } catch (e) { toast(e.message, 'danger'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph-upload-simple" aria-hidden="true"></i> Tải ảnh'; } }
  };
  pick.click();
}

// ===== Đợt 10: banner trang chủ =====
let BANNERS = [];
const ymdVN = (iso) => iso ? new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10) : '';
async function loadBanners() {
  const r = await api('admin?action=banner_list');
  BANNERS = r.banners;
  const now = new Date().toISOString();
  const state = (b) => !b.active ? pill('Tắt', 'muted') : (b.ends_at && b.ends_at < now) ? pill('Hết hạn', 'muted') : (b.starts_at && b.starts_at > now) ? pill('Chờ hiển thị', 'info') : pill('Đang hiển thị', 'ok');
  document.getElementById('bn-table').innerHTML = BANNERS.length ? `<table><thead><tr><th>Ảnh</th><th>Banner</th><th>Thời hạn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    BANNERS.map(b => `<tr><td><img src="${esc(b.image)}" alt="" style="height: 44px; border-radius: 6px; max-width: 130px; object-fit: cover;"></td>
          <td><b>${esc(b.title)}</b><div class="hint">Thứ tự ${b.sort}${b.link ? ' · mở ' + esc(b.link) : ''}${b.image_mobile ? ' · có ảnh điện thoại' : ''}</div></td>
          <td class="hint">${b.starts_at ? ymdVN(b.starts_at) : '—'}<br>${b.ends_at ? '→ ' + ymdVN(b.ends_at) : ''}</td><td>${state(b)}</td>
          <td class="row-actions"><button class="btn" data-on-click="editBanner('${esc(b.id)}')">Sửa</button><button class="btn danger" data-on-click="deleteBanner('${esc(b.id)}')">Xóa</button></td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Chưa có banner – trang chủ đang dùng 3 ảnh mặc định.</div>';
}
function previewBanner() {
  const v = val('bn-image'), im = document.getElementById('bn-preview');
  im.hidden = !v; if (v) im.src = v;
}
function resetBannerForm() {
  ['bn-id', 'bn-title', 'bn-image', 'bn-image-m', 'bn-link', 'bn-start', 'bn-end'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('bn-sort').value = '0'; document.getElementById('bn-active').value = 'true';
  previewBanner();
  markEditing('bn-form', '');
}
function editBanner(id) {
  const b = BANNERS.find(x => x.id === id);
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  set('bn-id', b.id); set('bn-title', b.title); set('bn-image', b.image); set('bn-image-m', b.image_mobile); set('bn-link', b.link);
  set('bn-sort', b.sort); set('bn-start', ymdVN(b.starts_at)); set('bn-end', ymdVN(b.ends_at)); set('bn-active', String(b.active));
  previewBanner();
  markEditing('bn-form', 'banner "' + b.title + '"', resetBannerForm);
}
const saveBanner = () => act(async () => {
  await post('banner_save', { id: val('bn-id') || undefined, title: val('bn-title'), image: val('bn-image'), image_mobile: val('bn-image-m'), link: val('bn-link'),
    sort: Number(val('bn-sort')) || 0, starts_at: val('bn-start'), ends_at: val('bn-end'), active: val('bn-active') === 'true' });
  resetBannerForm();
  await loadBanners();
}, 'Đã lưu banner – trang chủ cập nhật ngay');
const deleteBanner = (id) => act(async () => {
  if (!(await uiConfirm({ title: 'Xóa banner này?', body: 'Banner biến mất khỏi trang chủ ngay. Muốn tạm ẩn thì sửa trạng thái thành “Tắt”.', confirmLabel: 'Xóa banner', danger: true }))) return CANCEL;
  await post('banner_delete', { id }); if (val('bn-id') === String(id)) resetBannerForm(); await loadBanners();
}, 'Đã xóa banner');
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'bn-image') previewBanner(); });

let POSTS = [];
const localDT = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
async function loadPosts() {
  const r = await api('admin?action=post_list');
  POSTS = r.posts;
  const now = new Date().toISOString();
  const state = (p) => !p.published ? pill('Bản nháp', 'muted') : (p.ends_at && p.ends_at < now) ? pill('Hết hạn', 'muted') : (p.starts_at && p.starts_at > now) ? pill('Chờ hiển thị', 'info') : pill('Đang hiển thị', 'ok');
  document.getElementById('ps-table').innerHTML = POSTS.length ? `<table><thead><tr><th>Bài</th><th>Loại</th><th>Thời hạn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    POSTS.map(p => `<tr><td><b>${p.pinned ? '<i class="ph-tag" aria-hidden="true"></i> ' : ''}${esc(p.title)}</b><div class="hint">${esc(p.summary)}</div></td><td>${esc(p.type_label)}</td>
          <td class="hint">${p.starts_at ? t(p.starts_at) : '—'}<br>${p.ends_at ? '→ ' + t(p.ends_at) : ''}</td><td>${state(p)}</td>
          <td class="row-actions"><a class="btn" href="tin-tuc.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Xem</a><button class="btn" data-on-click="editPost('${esc(p.id)}')">Sửa</button><button class="btn danger" data-on-click="deletePost('${esc(p.id)}')">Xóa</button></td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Chưa có bài nào.</div>';
  const opts = (rows, label) => '<option value="">— Không —</option>' + rows.map(r => `<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');
  if (CAT) {
    const pm = val('ps-movie'), pc = val('ps-cinema');
    document.getElementById('ps-movie').innerHTML = opts(CAT.movies, m => m.title);
    document.getElementById('ps-cinema').innerHTML = opts(CAT.cinemas, c => c.name);
    document.getElementById('ps-movie').value = pm; document.getElementById('ps-cinema').value = pc;
  }
}
function resetPostForm() {
  ['ps-id', 'ps-title', 'ps-image', 'ps-start', 'ps-end', 'ps-summary', 'ps-body', 'ps-movie', 'ps-cinema'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ps-type').value = 'PROMO'; document.getElementById('ps-published').value = 'true'; document.getElementById('ps-pinned').value = 'false';
  markEditing('ps-form', '');
}
function editPost(id) {
  const p = POSTS.find(x => x.id === id);
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  set('ps-id', p.id); set('ps-title', p.title); set('ps-type', p.type); set('ps-image', p.image); set('ps-movie', p.movie_id || ''); set('ps-cinema', p.cinema_id || '');
  set('ps-start', localDT(p.starts_at)); set('ps-end', localDT(p.ends_at)); set('ps-published', String(p.published)); set('ps-pinned', String(p.pinned));
  set('ps-summary', p.summary); set('ps-body', p.body);
  markEditing('ps-form', 'bài "' + p.title + '"', resetPostForm);
}
const savePost = () => act(async () => {
  await post('post_save', { id: val('ps-id') || undefined, title: val('ps-title'), type: val('ps-type'), image: val('ps-image'), movie_id: val('ps-movie'), cinema_id: val('ps-cinema'),
    starts_at: val('ps-start') ? new Date(val('ps-start')).toISOString() : '', ends_at: val('ps-end') ? new Date(val('ps-end')).toISOString() : '',
    published: val('ps-published') === 'true', pinned: val('ps-pinned') === 'true', summary: val('ps-summary'), body: document.getElementById('ps-body').value });
  resetPostForm();
  await loadPosts();
}, 'Đã lưu bài');
const deletePost = (id) => act(async () => {
  if (!(await uiConfirm({ title: 'Xóa bài này?', body: 'Bài bị xóa không khôi phục được. Muốn tạm ẩn thì chuyển trạng thái thành “Bản nháp”.', confirmLabel: 'Xóa bài', danger: true }))) return CANCEL;
  await post('post_delete', { id }); if (val('ps-id') === String(id)) resetPostForm(); await loadPosts();
}, 'Đã xóa bài');

// ---- Danh mục chia 6 mục con (Đợt 11): mỗi lúc một nhóm thẻ, có đường dẫn riêng admin.html#danhmuc/<mục> ----
const DM_GROUPS = ['lich-chieu', 'phim', 'gia-ve', 'khuyen-mai', 'noi-dung', 'rap-phong'];
function dmShow(g, focusTab) {
  if (!DM_GROUPS.includes(g)) g = 'lich-chieu';
  const changed = dmGroup !== g;
  dmGroup = g;
  document.querySelectorAll('#tab-danhmuc [data-dm]').forEach(el => { el.hidden = el.dataset.dm !== g; });
  document.querySelectorAll('#dm-nav [role="tab"]').forEach(b => {
    const on = b.dataset.g === g;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    if (on && focusTab) b.focus();
  });
  if (tab === 'danhmuc') {
    const h = '#danhmuc/' + g;
    if (location.hash !== h) history.replaceState(null, '', h);
    if (changed) window.scrollTo(0, 0);
  }
}
document.querySelectorAll('#dm-nav [role="tab"]').forEach(b => { b.onclick = () => dmShow(b.dataset.g); });
document.getElementById('dm-nav').addEventListener('keydown', (e) => {
  const i = DM_GROUPS.indexOf(dmGroup);
  const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? DM_GROUPS.length - 1 : null;
  if (n == null) return;
  e.preventDefault();
  dmShow(DM_GROUPS[(n + DM_GROUPS.length) % DM_GROUPS.length], true);
});
// Thanh "Đang sửa …" phía trên form, có nút Hủy sửa; label rỗng = bỏ thanh (form về chế độ thêm mới)
function markEditing(formId, label, cancelFn) {
  const form = document.getElementById(formId);
  if (!form) return;
  let bar = form.previousElementSibling;
  if (!(bar && bar.classList.contains('editing-note'))) bar = null;
  form.classList.toggle('is-editing', !!label);
  if (!label) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.className = 'editing-note'; bar.setAttribute('role', 'status'); form.before(bar); }
  bar.innerHTML = `<i class="ph-note-pencil" aria-hidden="true"></i><span>Đang sửa: <b>${esc(label)}</b> – bấm Lưu để cập nhật</span><button type="button" class="btn ghost">Hủy sửa</button>`;
  bar.querySelector('button').onclick = cancelFn;
  bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Khóa ô mã khi đang sửa (đổi mã sẽ thành tạo bản ghi mới)
const lockId = (id, on) => { const el = document.getElementById(id); if (el) { el.readOnly = on; el.title = on ? 'Không đổi mã khi đang sửa – muốn tạo mới thì bấm Hủy sửa' : ''; } };
const MV_FIELDS = ['mv-id', 'mv-title', 'mv-short', 'mv-age', 'mv-dur', 'mv-meta', 'mv-poster', 'mv-format', 'mv-badge', 'mv-genre', 'mv-lang', 'mv-release', 'mv-director', 'mv-cast', 'mv-trailer', 'mv-synopsis'];
function resetMovieForm() {
  MV_FIELDS.forEach(id => { document.getElementById(id).value = ''; });
  const st = document.getElementById('mv-status'); if ([...st.options].some(o => o.value === 'NOW')) st.value = 'NOW';
  lockId('mv-id', false); markEditing('mv-form', '');
}
function resetVoucherForm() {
  ['vc-code', 'vc-discount', 'vc-label', 'vc-max', 'vc-per', 'vc-start', 'vc-end', 'vc-percent', 'vc-maxd', 'vc-min'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('vc-kind').value = 'AMOUNT'; document.getElementById('vc-combo').value = 'false'; document.getElementById('vc-active').value = 'true';
  drawVcDays();
  lockId('vc-code', false); markEditing('vc-form', '');
}
function resetCinemaForm() {
  ['cn-id', 'cn-name', 'cn-city', 'cn-address', 'cn-lat', 'cn-lng', 'cn-phone', 'cn-image', 'cn-intro', 'cn-amenities'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cn-active').value = 'true';
  lockId('cn-id', false); markEditing('cn-form', '');
}

async function loadCatalog() {
  loadPricing().catch(e => console.warn(e));
  loadBanners().catch(e => { document.getElementById('bn-table').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  CAT = await api('admin?action=catalog');
  const opt = (rows, label, sel) => rows.map(r => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
  document.getElementById('sc-movie').innerHTML = opt(CAT.movies.filter(m => m.status !== 'HIDDEN'), m => m.title, val('sc-movie'));
  document.getElementById('sc-cinema').innerHTML = opt(CAT.cinemas.filter(c => c.active), c => c.name, val('sc-cinema'));
  const fillRooms = () => {
    const cid = val('sc-cinema');
    document.getElementById('sc-room-id').innerHTML = '<option value="">— Sơ đồ chuẩn (74 ghế) —</option>' + opt(CAT.rooms.filter(r => r.cinema_id === cid && r.active !== false), r => r.name + ' · ' + r.seats + ' ghế', val('sc-room-id'));
    document.getElementById('sc-room').disabled = !!val('sc-room-id');
  };
  document.getElementById('sc-cinema').onchange = fillRooms;
  fillRooms();
  document.getElementById('rm-cinema').innerHTML = opt(CAT.cinemas, c => c.name, val('rm-cinema'));
  if (!val('rm-layout')) { document.getElementById('rm-layout').value = CAT.default_layout_text; previewRoom(); }
  const cname = (id) => (CAT.cinemas.find(c => c.id === id) || {}).name || id;
  document.getElementById('rm-table').innerHTML = CAT.rooms.length ? `<table><thead><tr><th>Phòng</th><th>Rạp</th><th>Số ghế</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    CAT.rooms.map(r => `<tr class="${r.active === false ? 'inactive' : ''}"><td><b>${esc(r.name)}</b>${r.kind ? `<div class="hint">${esc(r.kind)}</div>` : ''}</td><td>${esc(cname(r.cinema_id))}</td><td>${r.seats}</td>
          <td>${r.active === false ? pill('Ngừng', 'muted') : pill('Đang dùng', 'ok')}</td><td><button class="btn" data-on-click="editRoom('${esc(r.id)}')">Sửa</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Chưa có phòng riêng – mọi suất dùng sơ đồ chuẩn 74 ghế.</div>';
  const slc = document.getElementById('sl-cinema');
  slc.innerHTML = opt(CAT.cinemas, c => c.name, slc.value);
  const cpc = document.getElementById('cp-cinema');
  cpc.innerHTML = opt(CAT.cinemas.filter(c => c.active), c => c.name, cpc.value || slc.value);
  if (!document.getElementById('sc-date').value) document.getElementById('sc-date').value = CAT.today;
  if (!document.getElementById('sl-date').value) document.getElementById('sl-date').value = CAT.today;
  const ms = document.getElementById('mv-status'), keepSt = ms.value;
  ms.innerHTML = Object.entries(CAT.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  if (CAT.statuses[keepSt]) ms.value = keepSt;
  document.getElementById('mv-table').innerHTML = `<table><thead><tr><th>Phim</th><th>Tuổi</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    CAT.movies.map(m => `<tr><td><b>${esc(m.title)}</b><div class="hint mono">${esc(m.id)}</div></td><td>${esc(m.age)}</td>
          <td>${pill(CAT.statuses[m.status] || m.status, m.status === 'NOW' ? 'ok' : m.status === 'SOON' ? 'info' : 'muted')}</td>
          <td><button class="btn" data-on-click="editMovie('${esc(m.id)}')">Sửa</button></td></tr>`).join('')}</tbody></table>`;
  document.getElementById('vc-table').innerHTML = CAT.vouchers.length ? `<table><thead><tr><th>Mã</th><th>Giảm</th><th>Đã dùng</th><th>Hạn</th><th></th></tr></thead><tbody>${
    CAT.vouchers.map(v => `<tr class="${v.active ? '' : 'inactive'}"><td class="mono"><b>${esc(v.id)}</b><div class="hint">${esc(v.label)}</div></td><td>${vcText(v)}</td>
          <td>${v.used}${v.max_uses ? ' / ' + v.max_uses : ''}${v.per_customer ? `<div class="hint">${v.per_customer} lượt/khách</div>` : ''}</td>
          <td class="hint">${v.starts_at ? t(v.starts_at) : '—'}<br>${v.ends_at ? '→ ' + t(v.ends_at) : ''}</td>
          <td><button class="btn" data-on-click="editVoucher('${esc(v.id)}')">Sửa</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có voucher.</div>';
  document.getElementById('cn-table').innerHTML = `<table><thead><tr><th>Rạp</th><th>Thành phố</th><th>Địa chỉ</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    CAT.cinemas.map(c => `<tr class="${c.active ? '' : 'inactive'}"><td><b>${esc(c.name)}</b><div class="hint mono">${esc(c.id)}</div></td><td>${esc(c.city)}</td><td>${esc(c.address)}</td>
          <td>${c.active ? pill('Hoạt động', 'ok') : pill('Tạm đóng', 'muted')}</td>
          <td><button class="btn" data-on-click="editCinema('${esc(c.id)}')">Sửa</button></td></tr>`).join('')}</tbody></table>`;
  await loadShowtimeList();
  await loadPosts();
  loadCampaigns();
}
// Lịch dạng bảng (Đợt 6): mỗi hàng một phòng, trục ngang 08:00 → 02:00 hôm sau
let SL = [];
function toggleGrid() {
  const g = document.getElementById('sl-grid');
  g.hidden = !g.hidden;
  document.getElementById('sl-grid-btn').classList.toggle('primary', !g.hidden);
  if (!g.hidden) renderGrid();
}
function renderGrid() {
  const g = document.getElementById('sl-grid');
  if (g.hidden) return;
  if (!SL.length) { g.innerHTML = '<div class="empty">Không có suất trong ngày.</div>'; return; }
  const START = 8 * 60, SPAN = 18 * 60; // 08:00 -> 02:00
  const mins = (s) => { const [h, m] = s.time.split(':').map(Number); const v = h * 60 + m; return v < START ? v + 1440 : v; };
  const rooms = [...new Set(SL.map(s => s.room))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const hue = (k) => [...String(k)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  // Suất chồng giờ trong cùng phòng (giờ chiếu + 15 phút dọn phòng) -> viền đỏ để Quản lý sửa
  const clash = new Set();
  rooms.forEach(r => {
    const list = SL.filter(s => s.room === r && s.active).sort((x, y) => mins(x) - mins(y));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      if (mins(list[i]) < mins(prev) + ((prev.movie && prev.movie.duration_min) || 120) + 15) { clash.add(prev.id); clash.add(list[i].id); }
    }
  });
  const ticks = Array.from({ length: 19 }, (_, i) => { const h = (8 + i) % 24; return `<span style="position:absolute;left:${i / 18 * 100}%;font-size:11px;color:#64748b;transform:translateX(-50%)">${String(h).padStart(2, '0')}h</span>`; }).join('');
  g.innerHTML = `<div style="min-width:900px;margin:6px 0 12px">
        <div style="display:grid;grid-template-columns:130px 1fr;gap:6px;align-items:center">
          ${clash.size ? `<div style="grid-column:1 / -1;color:#b91c1c;font-size:13px;font-weight:700">⚠ ${clash.size} suất chồng giờ trong cùng phòng (viền đỏ) – ngừng bán hoặc đổi phòng.</div>` : ''}
          <div></div><div style="position:relative;height:16px">${ticks}</div>
          ${rooms.map(r => `<div style="font-size:12.5px;font-weight:700">${esc(r)}</div>
            <div style="position:relative;height:54px;background:repeating-linear-gradient(90deg,#f8fafc 0,#f8fafc calc(100%/18 - 1px),#e2e8f0 calc(100%/18 - 1px),#e2e8f0 calc(100%/18));border-radius:6px">
              ${SL.filter(s => s.room === r).map(s => {
            const dur = (s.movie && s.movie.duration_min) || 120, left = (mins(s) - START) / SPAN * 100, w = Math.max(3, dur / SPAN * 100);
            const sold = s.seats_total - s.seats_free, past = new Date(s.starts_at) <= new Date();
            return `<div title="${esc((s.movie || {}).title || s.movie_key)} · ${s.time}–${s.end_time || ''} · ${sold}/${s.seats_total} ghế${s.active ? '' : ' · NGỪNG BÁN'}${clash.has(s.id) ? ' · TRÙNG GIỜ' : ''}" style="position:absolute;top:3px;bottom:3px;left:${left}%;width:${w}%;background:hsl(${hue(s.movie_key)} 70% ${s.active ? 88 : 96}%);border:${clash.has(s.id) ? '2.5px solid #b91c1c' : '1.5px solid hsl(' + hue(s.movie_key) + ' 55% 45%)'};border-radius:6px;padding:2px 5px;overflow:hidden;font-size:11px;line-height:1.3;${past ? 'opacity:.55;' : ''}${s.active ? '' : 'text-decoration:line-through;'}">
                  <b>${s.time}</b> ${esc(((s.movie || {}).shortTitle || (s.movie || {}).title || s.movie_key).slice(0, 26))}<br>${sold}/${s.seats_total}</div>`;
          }).join('')}
            </div>`).join('')}
        </div></div>`;
}
const copyWeek = () => act(async () => {
  const days = Number(val('cp-days')) || 1, fmt = (d) => d.split('-').reverse().join('/');
  const span = (d) => fmt(d) + (days > 1 ? ' → ' + fmt(dbAddDays(d, days - 1)) : '');
  const cname = (document.getElementById('cp-cinema').selectedOptions[0] || {}).textContent || '';
  if (!(await uiConfirm({ title: 'Sao chép lịch chiếu?', confirmLabel: 'Sao chép',
    body: kvHtml([['Rạp', esc(cname)], ['Lấy lịch của', esc(span(val('cp-from')))], ['Chép sang', esc(span(val('cp-to')))]]) + '<p class="hint">Giữ nguyên giờ, phòng, phim, giá riêng. Bỏ qua suất đã có, đã qua giờ, phòng bận, phim đã ẩn.</p>' }))) return CANCEL;
  const r = await post('showtime_copy', { cinema_id: val('cp-cinema'), from: val('cp-from'), to: val('cp-to'), days: val('cp-days') });
  document.getElementById('cp-result').textContent = `Đã tạo ${r.created}/${r.source} suất.` + (r.skipped.length ? ' Bỏ qua: ' + r.skipped.slice(0, 12).join('; ') + (r.skipped.length > 12 ? '…' : '') : '');
  if (val('cp-cinema') === val('sl-cinema')) await loadShowtimeList();
  return r;
}, (r) => `Đã sao chép ${r.created}/${r.source} suất chiếu`);
async function loadInsights() {
  const box = document.getElementById('sl-insights');
  try {
    const r = await api('admin?action=schedule_insights&cinema=' + encodeURIComponent(val('sl-cinema')));
    box.innerHTML = r.rows.length ? `<table><thead><tr><th>Phim</th><th>Suất 14 ngày qua</th><th>Lấp đầy</th><th>Suất 7 ngày tới</th><th>Gợi ý</th></tr></thead><tbody>${
      r.rows.map(x => `<tr><td>${esc(x.title)}</td><td>${x.past_shows}</td><td>${x.rate == null ? '—' : x.rate + '%'}</td><td>${x.next_7d}</td><td>${x.advice ? pill(x.advice, /tăng/.test(x.advice) ? 'ok' : /giảm/.test(x.advice) ? 'warn' : 'danger') : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có dữ liệu.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

// ---- Email ưu đãi (Đợt 6) ----
let CM = null;
async function loadCampaigns() {
  try {
    CM = await api('admin?action=campaign_list');
    const seg = document.getElementById('cm-seg');
    if (!seg.options.length) { seg.innerHTML = Object.entries(CM.segments).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); cmParam(); previewCampaign(); }
    if (!CM.mail_ready) document.getElementById('cm-sub').innerHTML = '<span style="color:#b91c1c">Chưa cấu hình RESEND_API_KEY / MAIL_FROM – thư sẽ không được gửi thật.</span>';
    document.getElementById('cm-table').innerHTML = CM.campaigns.length ? `<table><thead><tr><th>Ngày</th><th>Tiêu đề</th><th>Nhóm</th><th>Đã gửi</th><th>Lỗi / bỏ qua</th><th>Trạng thái</th></tr></thead><tbody>${
      CM.campaigns.map(c => `<tr><td class="hint">${t(c.created_at)}</td><td>${esc(c.subject)}<div class="hint">${esc(c.created_by || '')}</div></td><td>${esc(c.segment_label)}${c.param ? ' · ' + esc(c.param) : ''}</td>
            <td>${c.sent}/${c.total}</td><td>${c.failed} / ${c.skipped}</td><td>${c.status === 'DONE' ? pill('Xong', 'ok') : `${pill('Đang gửi', 'warn')} <button class="btn" data-on-click="runCampaign('${c.id}')">Tiếp tục</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa gửi chiến dịch nào.</div>';
  } catch (e) { document.getElementById('cm-table').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
function cmParam() {
  const s = val('cm-seg'), wrap = document.getElementById('cm-param-wrap'), p = document.getElementById('cm-param');
  wrap.hidden = !['TIER', 'FAV_MOVIE', 'INACTIVE'].includes(s);
  document.getElementById('cm-param-label').textContent = s === 'TIER' ? 'Hạng' : s === 'FAV_MOVIE' ? 'Phim' : 'Không đặt vé trong';
  p.innerHTML = s === 'TIER' ? '<option value="VIP">VIP</option><option value="VVIP">VVIP</option><option value="MEMBER">Thành viên</option>'
    : s === 'FAV_MOVIE' ? (CAT ? CAT.movies : []).map(m => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')
    : '<option value="30">30 ngày</option><option value="60" selected>60 ngày</option><option value="90">90 ngày</option>';
}
let cmCount = null;
async function previewCampaign() {
  const box = document.getElementById('cm-count'), btn = document.getElementById('cm-send');
  try {
    const r = await post('campaign_preview', { segment: val('cm-seg'), param: val('cm-param') });
    cmCount = Number(r.count) || 0;
    box.textContent = cmCount ? 'Sẽ gửi tới ' + cmCount + ' khách đã đồng ý nhận email.' : 'Nhóm này chưa có khách nào đồng ý nhận email – chọn nhóm khác.';
    btn.disabled = !cmCount;
  } catch (e) { cmCount = null; box.textContent = e.message; btn.disabled = false; }
}
const sendCampaign = () => act(async () => {
  if (cmCount === 0) throw new Error('Nhóm khách này chưa có ai đồng ý nhận email.');
  if (!(await uiConfirm({ title: 'Gửi email ưu đãi?', confirmLabel: 'Gửi email',
    body: kvHtml([['Tiêu đề', esc(val('cm-subject'))], ['Nhóm khách', esc(document.getElementById('cm-seg').selectedOptions[0] ? document.getElementById('cm-seg').selectedOptions[0].textContent : '')], ['Số người nhận', esc(document.getElementById('cm-count').textContent)]]) + '<p>Thư đã gửi không thu hồi được.</p>' }))) return CANCEL;
  const r = await post('campaign_create', { subject: val('cm-subject'), message: val('cm-message'), segment: val('cm-seg'), param: val('cm-param') });
  await runCampaign(r.id);
  document.getElementById('cm-subject').value = ''; document.getElementById('cm-message').value = '';
}, 'Đã bắt đầu gửi email ưu đãi');
// Gửi từng đợt nhỏ cho tới khi xong (giữ trang mở); đóng trang giữa chừng thì bấm "Tiếp tục"
async function runCampaign(id) {
  const box = document.getElementById('cm-progress'), btn = document.getElementById('cm-send');
  btn.disabled = true;
  try {
    for (let i = 0; i < 2000; i++) {
      const c = (await post('campaign_step', { id })).campaign;
      box.textContent = `Đang gửi "${c.subject}": ${c.cursor}/${c.total} (gửi được ${c.sent}, lỗi ${c.failed}, bỏ qua ${c.skipped}). Giữ trang này mở.`;
      if (c.status === 'DONE') { box.textContent = `✓ Xong "${c.subject}": gửi được ${c.sent}/${c.total}, lỗi ${c.failed}, bỏ qua ${c.skipped}.`; break; }
    }
  } catch (e) { box.textContent = 'Dừng: ' + e.message + ' – bấm "Tiếp tục" để gửi phần còn lại.'; }
  finally { btn.disabled = cmCount === 0; await loadCampaigns(); }
}

async function loadShowtimeList() {
  const r = await api('admin?action=showtime_list&cinema=' + encodeURIComponent(val('sl-cinema')) + '&date=' + encodeURIComponent(val('sl-date')));
  SL = r.showtimes;
  renderGrid();
  loadInsights();
  if (!val('cp-from')) { document.getElementById('cp-from').value = val('sl-date'); document.getElementById('cp-to').value = CAT.today ? new Date(new Date(val('sl-date') + 'T00:00:00Z').getTime() + 7 * 864e5).toISOString().slice(0, 10) : ''; }
  const now = Date.now();
  document.getElementById('sl-table').innerHTML = r.showtimes.length ? `<table><thead><tr><th>Giờ</th><th>Phim</th><th>Định dạng / phòng</th><th>Giá (thường / VIP / đôi)</th><th>Ghế đã bán/giữ</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    r.showtimes.map(x => { const past = new Date(x.starts_at).getTime() <= now; const sold = x.seats_total - x.seats_free; return `<tr class="${x.active ? '' : 'inactive'}">
          <td><b>${x.time}</b></td><td>${esc(x.movie.title)}</td><td>${esc(x.format)}<div class="hint">${esc(x.room)}</div></td>
          <td>${vnd(x.prices.standard)} / ${vnd(x.prices.vip)} / ${vnd(x.prices.sweetbox)}</td><td>${sold} / ${x.seats_total}</td>
          <td>${past ? pill('Đã chiếu', 'muted') : x.active ? pill('Đang bán', 'ok') : pill('Ngừng bán', 'danger')}</td>
          <td>${past ? '' : `<button class="btn ${x.active ? 'danger' : 'ok'}" data-on-click="toggleShowtime('${x.id}', ${!x.active})">${x.active ? 'Ngừng bán' : 'Mở bán lại'}</button>`}</td></tr>`; }).join('')
  }</tbody></table>` : '<div class="empty">Rạp chưa có suất chiếu nào trong ngày này.</div>';
}
const createShowtimes = () => act(async () => {
  const r = await post('showtime_create', { movie_id: val('sc-movie'), cinema_id: val('sc-cinema'), date: val('sc-date'), days: val('sc-days'), times: val('sc-times'),
    format: val('sc-format'), room: val('sc-room'), room_id: val('sc-room-id'), price_standard: val('sc-p1'), price_vip: val('sc-p2'), price_sweetbox: val('sc-p3') });
  // Có suất bị bỏ qua (trùng, đã qua giờ, phòng bận) -> thông báo giữ lại tới khi đóng để kịp đọc
  toast(`Đã tạo ${r.created} suất chiếu.` + (r.skipped.length ? '\nBỏ qua ' + r.skipped.length + ': ' + r.skipped.slice(0, 8).join('; ') + (r.skipped.length > 8 ? '…' : '') : ''), r.skipped.length ? 'warn' : 'ok', r.skipped.length ? 0 : undefined);
  document.getElementById('sl-cinema').value = val('sc-cinema');
  document.getElementById('sl-date').value = val('sc-date');
  await loadShowtimeList();
});
const toggleShowtime = (id, active) => act(async () => {
  if (!active && !(await uiConfirm({ title: 'Ngừng bán suất chiếu này?', body: 'Khách sẽ không đặt được suất này nữa. Vé đã bán không bị ảnh hưởng.', confirmLabel: 'Ngừng bán', danger: true }))) return CANCEL;
  await post('showtime_update', { id, active });
  await loadShowtimeList();
}, active ? 'Đã mở bán lại suất chiếu' : 'Đã ngừng bán suất chiếu');
function editMovie(id) {
  const m = CAT.movies.find(x => x.id === id);
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  set('mv-id', m.id); set('mv-title', m.title); set('mv-short', m.short_title); set('mv-age', m.age); set('mv-dur', m.duration_min);
  set('mv-status', m.status || 'NOW'); set('mv-meta', m.meta); set('mv-poster', m.poster); set('mv-format', m.format); set('mv-badge', m.badge);
  set('mv-genre', m.genre); set('mv-lang', m.language); set('mv-release', m.release_date); set('mv-director', m.director);
  set('mv-cast', m.cast_list); set('mv-trailer', m.trailer); set('mv-synopsis', m.synopsis);
  lockId('mv-id', true);
  markEditing('mv-form', 'phim "' + m.title + '"', resetMovieForm);
}
const saveMovie = () => act(async () => {
  await post('movie_save', { id: val('mv-id'), title: val('mv-title'), short_title: val('mv-short'), age: val('mv-age'), duration_min: val('mv-dur'),
    status: val('mv-status'), meta: val('mv-meta'), poster: val('mv-poster'), format: val('mv-format'), badge: val('mv-badge'),
    genre: val('mv-genre'), language: val('mv-lang'), release_date: val('mv-release'), director: val('mv-director'), cast: val('mv-cast'),
    trailer: val('mv-trailer'), synopsis: val('mv-synopsis') });
  resetMovieForm();
  await loadCatalog();
}, 'Đã lưu phim');
const DOW_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
// Mô tả voucher có điều kiện cho bảng danh mục
function vcText(v) {
  const k = String(v.kind || 'AMOUNT').toUpperCase();
  const main = k === 'PERCENT' ? v.percent + '%' + (v.max_discount ? ' (tối đa ' + vnd(v.max_discount) + ')' : '') : k === 'PER_SEAT' ? vnd(v.discount) + ' / ghế' : vnd(v.discount);
  const cond = [v.min_total ? 'đơn từ ' + vnd(v.min_total) : '', v.need_combo ? 'kèm bắp nước' : '', (v.weekdays || []).length ? v.weekdays.map(d => DOW_SHORT[d]).join(', ') : ''].filter(Boolean);
  return main + (cond.length ? '<div class="hint">' + esc(cond.join(' · ')) + '</div>' : '');
}
function drawVcDays(sel = []) {
  document.getElementById('vc-days').innerHTML = DOW_SHORT.map((n, i) => `<label style="display:inline-flex;gap:3px;align-items:center"><input type="checkbox" value="${i}" ${sel.includes(i) ? 'checked' : ''}>${n}</label>`).join('');
}
const vcDays = () => [...document.querySelectorAll('#vc-days input:checked')].map(x => Number(x.value));
document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('vc-days')) drawVcDays(); });
function editVoucher(id) {
  const v = CAT.vouchers.find(x => x.id === id);
  const loc = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const set = (k, x) => { document.getElementById(k).value = x == null ? '' : x; };
  set('vc-code', v.id); set('vc-discount', v.discount); set('vc-label', v.label); set('vc-max', v.max_uses); set('vc-per', v.per_customer);
  set('vc-start', loc(v.starts_at)); set('vc-end', loc(v.ends_at)); set('vc-active', String(v.active !== false));
  set('vc-kind', String(v.kind || 'AMOUNT').toUpperCase()); set('vc-percent', v.percent); set('vc-maxd', v.max_discount); set('vc-min', v.min_total);
  set('vc-combo', String(!!v.need_combo)); drawVcDays((v.weekdays || []).map(Number));
  lockId('vc-code', true);
  markEditing('vc-form', 'voucher ' + v.id, resetVoucherForm);
}
const saveVoucher = () => act(async () => {
  await post('voucher_save', { code: val('vc-code'), kind: val('vc-kind'), percent: val('vc-percent'), max_discount: val('vc-maxd'), min_total: val('vc-min'),
    need_combo: val('vc-combo') === 'true', weekdays: vcDays(), discount: val('vc-discount'), label: val('vc-label'), max_uses: val('vc-max'), per_customer: val('vc-per'),
    starts_at: val('vc-start') ? new Date(val('vc-start')).toISOString() : '', ends_at: val('vc-end') ? new Date(val('vc-end')).toISOString() : '', active: val('vc-active') === 'true' });
  resetVoucherForm();
  await loadCatalog();
}, 'Đã lưu voucher');
// Phòng chiếu: xem trước sơ đồ ngay khi gõ (cùng hàm kiểm tra với máy chủ)
function previewRoom() {
  const msg = document.getElementById('rm-msg'), box = document.getElementById('rm-preview');
  try {
    const L = BetaCatalog.layoutFromText(val('rm-layout'));
    const seats = BetaCatalog.seatsOf(L);
    const cnt = (t) => seats.filter(s => s.type === t).length;
    msg.textContent = `${seats.length} chỗ bán: ${cnt('standard')} thường, ${cnt('vip')} VIP, ${cnt('sweetbox')} ghế đôi`;
    msg.style.color = '';
    const col = { standard: '#64748b', vip: '#f59e0b', sweetbox: '#ec4899' };
    box.innerHTML = '<div style="text-align:center;font-size:11px;letter-spacing:3px;color:#005198;font-weight:800;margin-bottom:6px">MÀN HÌNH</div>' + L.rows.map(x => {
      let h = '<div style="display:flex;gap:3px;justify-content:center;margin:3px 0;align-items:center"><span style="width:16px;font-size:11px;color:#64748b">' + x.r + '</span>';
      for (let k = 1; k <= x.n; k++) {
        const w = x.type === 'sweetbox' ? 34 : 15;
        h += `<span title="${x.r}${k}" style="width:${w}px;height:13px;border-radius:3px;background:${x.off.includes(k) ? 'transparent' : col[x.type]};${x.off.includes(k) ? 'outline:1px dashed #cbd5e1' : ''}"></span>`;
        if (x.gaps.includes(k)) h += '<span style="width:12px"></span>';
      }
      return h + '</div>';
    }).join('');
  } catch (e) { msg.textContent = e.message; msg.style.color = '#b91c1c'; box.innerHTML = ''; }
}
function editRoom(id) {
  const r = CAT.rooms.find(x => x.id === id);
  document.getElementById('rm-id').value = r.id; document.getElementById('rm-cinema').value = r.cinema_id;
  document.getElementById('rm-name').value = r.name; document.getElementById('rm-kind').value = r.kind || '';
  document.getElementById('rm-active').value = String(r.active !== false); document.getElementById('rm-layout').value = r.layout_text;
  previewRoom();
  markEditing('rm-form', r.name, resetRoom);
}
function resetRoom() {
  ['rm-id', 'rm-name', 'rm-kind'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('rm-active').value = 'true';
  document.getElementById('rm-layout').value = CAT.default_layout_text; previewRoom();
  markEditing('rm-form', '');
}
const saveRoom = () => act(async () => {
  await post('room_save', { id: val('rm-id'), cinema_id: val('rm-cinema'), name: val('rm-name'), kind: val('rm-kind'), active: val('rm-active') === 'true', layout_text: val('rm-layout') });
  resetRoom();
  await loadCatalog();
}, 'Đã lưu phòng chiếu');

function editCinema(id) {
  const c = CAT.cinemas.find(x => x.id === id);
  document.getElementById('cn-id').value = c.id; document.getElementById('cn-name').value = c.name;
  document.getElementById('cn-city').value = c.city || ''; document.getElementById('cn-address').value = c.address || '';
  document.getElementById('cn-active').value = String(c.active);
  document.getElementById('cn-lat').value = c.lat == null ? '' : c.lat; document.getElementById('cn-lng').value = c.lng == null ? '' : c.lng;
  document.getElementById('cn-phone').value = c.phone || ''; document.getElementById('cn-image').value = c.image || '';
  document.getElementById('cn-intro').value = c.intro || ''; document.getElementById('cn-amenities').value = (c.amenities || []).join(', ');
  lockId('cn-id', true);
  markEditing('cn-form', c.name, resetCinemaForm);
}
const saveCinema = () => act(async () => {
  await post('cinema_save', { id: val('cn-id'), name: val('cn-name'), city: val('cn-city'), address: val('cn-address'), active: val('cn-active') === 'true', lat: val('cn-lat'), lng: val('cn-lng'),
    phone: val('cn-phone'), image: val('cn-image'), intro: val('cn-intro'), amenities: val('cn-amenities') });
  resetCinemaForm();
  await loadCatalog();
}, 'Đã lưu rạp');

// ---------------- NHÂN SỰ & NHẬT KÝ (Quản lý) ----------------
let STAFF = [], ROLES = {}, AUDIT = [];
async function loadStaff() {
  const [st, au] = await Promise.all([api('admin?action=staff_list'), api('admin?action=audit')]);
  STAFF = st.staff; ROLES = st.roles; AUDIT = au.logs;
  const nsr = document.getElementById('ns-role'), keepRole = ROLES[nsr.value] ? nsr.value : 'CS';
  nsr.innerHTML = Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === keepRole ? 'selected' : ''}>${esc(v)}</option>`).join('');
  document.getElementById('staff-table').innerHTML = `<table><thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Bảo mật 2 lớp</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>${
    STAFF.map(x => `<tr class="${x.active ? '' : 'inactive'}"><td><b>${esc(x.full_name)}</b></td><td class="mono">${esc(x.email)}</td>
          <td><select aria-label="Vai trò của ${esc(x.name || x.email || '')}" data-on-change="updateStaff('${x.id}', { role: this.value })" ${x.id === ME.id ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === x.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
          <td>${x.active ? pill('Đang hoạt động', 'ok') : pill('Đã khóa', 'muted')}</td><td>${x.totp_enabled ? pill('Đã bật', 'ok') : pill('Chưa bật', ['MANAGER', 'ACCOUNTANT'].includes(x.role) ? 'warn' : 'muted')}</td><td>${t(x.last_login_at) || '—'}</td>
          <td class="row-actions">${x.id === ME.id ? '<span class="hint">(bạn)</span>' : `
            <button class="btn" data-on-click="resetStaffPass('${x.id}')">Đặt lại mật khẩu</button>
            ${x.totp_enabled ? `<button class="btn" data-on-click="reset2fa('${x.id}')" title="Nhân viên mất điện thoại">Tắt 2 lớp</button>` : ''}
            <button class="btn ${x.active ? 'danger' : 'ok'}" data-on-click="updateStaff('${x.id}', { active: ${!x.active} })">${x.active ? 'Khóa' : 'Mở khóa'}</button>`}</td></tr>`).join('')
  }</tbody></table>`;
  renderAudit();
}
const AUDIT_LABEL = { login: 'Đăng nhập', send_to_accounting: 'Gửi Kế toán', accounting_reject: 'Trả về nhân viên', accounting_paid: 'Duyệt chi', decide: 'Đối chiếu hồ sơ',
  remind: 'Nhắc khách', confirm_done: 'Xác nhận hoàn tất', resolve_ticket: 'Đóng phiếu', ticket_reply: 'Trả lời khách', run_job: 'Chạy Job', staff_create: 'Thêm nhân viên', staff_update: 'Sửa nhân viên',
  movie_save: 'Lưu phim', ticket_type_save: 'Sửa loại vé', post_save: 'Lưu tin / ưu đãi', post_delete: 'Xóa tin / ưu đãi', price_rule_save: 'Lưu quy tắc giá', price_rule_delete: 'Xóa quy tắc giá', holiday_save: 'Thêm ngày lễ', holiday_delete: 'Xóa ngày lễ', dashboard: 'Xem tổng quan', cinema_save: 'Lưu rạp', showtime_create: 'Tạo suất chiếu', room_save: 'Lưu phòng chiếu', showtime_copy: 'Sao chép lịch chiếu', campaign_create: 'Gửi email ưu đãi', review_hide: 'Ẩn/hiện đánh giá', event_update: 'Cập nhật yêu cầu thuê rạp', invoice_issue: 'Xác nhận đã xuất hóa đơn', invoice_cancel: 'Hủy yêu cầu hóa đơn', showtime_update: 'Sửa suất chiếu', voucher_save: 'Lưu voucher', checkin: 'Soát vé',
  change_password: 'Đổi mật khẩu', totp_setup: 'Tạo mã bảo mật 2 lớp', totp_enable: 'Bật bảo mật 2 lớp', totp_disable: 'Tắt bảo mật 2 lớp', staff_reset_2fa: 'Đặt lại bảo mật 2 lớp của nhân viên', ticket_assign: 'Nhận / trả phiếu', ticket_note: 'Ghi chú nội bộ phiếu', staff_resend_ticket: 'Gửi lại vé cho khách', accounting_paid_batch: 'Đã chi hàng loạt', day_close: 'Chốt sổ ngày', day_reopen: 'Mở lại sổ ngày', payout_csv: 'Xuất bảng kê chuyển khoản', bootstrap_manager: 'Tạo Quản lý đầu tiên' };
function renderAudit() {
  // Danh sách lọc theo nhân viên / thao tác dựng từ chính nhật ký (giữ lựa chọn đang chọn)
  const fs = document.getElementById('au-staff'), fa = document.getElementById('au-action');
  const keepS = fs.value, keepA = fa.value;
  const names = [...new Set(AUDIT.map(l => l.staff_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const acts = [...new Set(AUDIT.map(l => l.action).filter(Boolean))].sort((a, b) => (AUDIT_LABEL[a] || a).localeCompare(AUDIT_LABEL[b] || b, 'vi'));
  fs.innerHTML = '<option value="">Mọi nhân viên</option>' + names.map(n => `<option value="${esc(n)}" ${n === keepS ? 'selected' : ''}>${esc(n)}</option>`).join('');
  fa.innerHTML = '<option value="">Mọi thao tác</option>' + acts.map(a => `<option value="${esc(a)}" ${a === keepA ? 'selected' : ''}>${esc(AUDIT_LABEL[a] || a)}</option>`).join('');
  const q = document.getElementById('au-search').value.trim().toLowerCase();
  const rows = AUDIT.filter(l => (!fs.value || l.staff_name === fs.value) && (!fa.value || l.action === fa.value))
    .filter(l => !q || [l.staff_name, l.action, AUDIT_LABEL[l.action], l.target, JSON.stringify(l.detail || {})].join(' ').toLowerCase().includes(q));
  document.getElementById('audit-table').innerHTML = rows.length ? `<table><thead><tr><th>Thời điểm</th><th>Nhân viên</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${
    rows.map(l => `<tr><td>${t(l.created_at)}</td><td>${esc(l.staff_name)} ${l.role ? pill(ROLES[l.role] || l.role, 'muted') : ''}</td><td>${esc(AUDIT_LABEL[l.action] || l.action)}</td>
          <td class="mono">${esc(l.target || '')}</td><td class="hint">${esc(Object.entries(l.detail || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => k + ': ' + v).join(' · '))}</td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Chưa có thao tác nào.</div>';
}
// Mật khẩu tạm gợi ý (Quản lý có thể sửa): đủ dài, dễ đọc qua điện thoại
const tempPass = () => 'Beta-' + Math.random().toString(36).slice(2, 6) + '-' + Math.floor(1000 + Math.random() * 9000);
const createStaff = () => act(async () => {
  const name = document.getElementById('ns-name').value.trim(), email = document.getElementById('ns-email').value.trim(), pw = document.getElementById('ns-pass').value;
  const role = document.getElementById('ns-role').value;
  await post('staff_create', { full_name: name, email, role, password: pw });
  ['ns-name', 'ns-email', 'ns-pass'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ns-role').value = 'CS';
  await loadStaff();
  // Hiện lại thông tin đăng nhập một lần để Quản lý bàn giao (sau khi đóng sẽ không xem lại được)
  await uiDialog({ title: 'Đã tạo tài khoản ' + (ROLES[role] || role), hideCancel: true, confirmLabel: 'Đã ghi lại',
    body: kvHtml([['Họ tên', esc(name)], ['Email đăng nhập', `<span class="mono">${esc(email)}</span>`], ['Mật khẩu tạm', `<span class="mono">${esc(pw)}</span>`]]) + '<p class="hint">Gửi mật khẩu tạm qua kênh riêng (gặp trực tiếp / tin nhắn riêng), nhắc nhân viên đổi mật khẩu ở lần đăng nhập đầu.</p>' });
}, 'Đã tạo tài khoản nhân viên');
const updateStaff = (id, patch) => act(async () => {
  const x = STAFF.find(s => s.id === id) || {};
  if (patch.active === false && !(await uiConfirm({ title: 'Khóa tài khoản ' + (x.full_name || '') + '?', body: 'Nhân viên bị đăng xuất ngay và không đăng nhập được nữa cho tới khi mở khóa.', confirmLabel: 'Khóa tài khoản', danger: true }))) return CANCEL;
  // Đổi vai trò là đổi quyền ngay lập tức -> luôn hỏi lại (trước đây chọn nhầm trong danh sách là áp dụng luôn)
  if (patch.role && !(await uiConfirm({ title: `Đổi vai trò của ${x.full_name || ''}?`, confirmLabel: 'Đổi vai trò', danger: patch.role === 'MANAGER',
    body: kvHtml([['Từ', esc(ROLES[x.role] || x.role || '')], ['Thành', '<b>' + esc(ROLES[patch.role] || patch.role) + '</b>']]) + (patch.role === 'MANAGER' ? '<p>Quản lý có <b>toàn quyền</b>: nhân sự, danh mục, sao lưu dữ liệu khách hàng.</p>' : '<p>Quyền của nhân viên thay đổi ngay khi lưu.</p>') }))) { await loadStaff(); return CANCEL; }
  try { await post('staff_update', { id, ...patch }); } catch (e) { await loadStaff().catch(() => {}); throw e; } // lỗi: vẽ lại theo dữ liệu thật
  await loadStaff();
}, patch.active === false ? 'Đã khóa tài khoản' : patch.active === true ? 'Đã mở khóa tài khoản' : 'Đã đổi vai trò');
const resetStaffPass = (id) => act(async () => {
  const x = STAFF.find(s => s.id === id) || {};
  const pw = await uiPrompt({ title: 'Đặt lại mật khẩu · ' + (x.full_name || ''), label: 'Mật khẩu tạm mới', value: tempPass(), required: true, minlength: 8, confirmLabel: 'Đặt lại mật khẩu',
    hint: 'Ít nhất 8 ký tự. Nhân viên bị đăng xuất khỏi mọi thiết bị; gửi mật khẩu tạm qua kênh riêng.' });
  if (pw === null) return CANCEL;
  await post('staff_update', { id, password: pw });
}, 'Đã đặt lại mật khẩu – gửi mật khẩu tạm cho nhân viên qua kênh riêng');

function badge(id, n) { const el = document.getElementById(id); el.hidden = !n; el.textContent = n; }

// ---------------- CSKH ----------------
// Thuê rạp / vé nhóm (Đợt 3)
let EVENTS = { requests: [], statuses: {}, kinds: {} };
async function loadEvents() {
  const box = document.getElementById('events');
  try {
    EVENTS = await api('admin?action=event_list');
    if (overview) renderWork();
    const tone = { NEW: 'danger', QUOTED: 'warn', CONFIRMED: 'ok', DONE: 'muted', CANCELLED: 'muted' };
    box.innerHTML = EVENTS.requests.length ? `<table><thead><tr><th>Mã</th><th>Loại</th><th>Khách</th><th>Rạp / ngày</th><th>Số khách</th><th>Báo giá</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
      EVENTS.requests.map(x => `<tr><td class="mono">${esc(x.code)}<div class="hint">${t(x.created_at)}</div></td><td>${esc(EVENTS.kinds[x.kind] || x.kind)}</td>
            <td><b>${esc(x.contact_name)}</b>${x.company ? '<div class="hint">' + esc(x.company) + '</div>' : ''}<div class="hint mono">${esc(x.phone)}${x.email ? ' · ' + esc(x.email) : ''}</div></td>
            <td>${esc(x.cinema_name || 'Chưa chọn rạp')}<div class="hint">${x.date ? x.date.split('-').reverse().join('/') : 'Chưa chọn ngày'}${x.time ? ' ' + esc(x.time) : ''}${x.movie_title ? ' · ' + esc(x.movie_title) : ''}</div>${x.note ? '<div class="hint">' + esc(x.note) + '</div>' : ''}</td>
            <td>${x.guests}</td><td>${x.quote_amount ? vnd(x.quote_amount) : '—'}</td><td>${pill(EVENTS.statuses[x.status] || x.status, tone[x.status])}</td>
            <td style="white-space: nowrap;">${['DONE', 'CANCELLED'].includes(x.status) ? '' : `
              ${x.status !== 'CONFIRMED' ? `<button class="btn" data-on-click="eventQuote('${esc(x.code)}')">Báo giá</button>` : ''}
              ${x.status === 'QUOTED' ? `<button class="btn ok" data-on-click="eventSet('${esc(x.code)}', 'CONFIRMED')">Chốt</button>` : ''}
              ${x.status === 'CONFIRMED' ? `<button class="btn ok" data-on-click="eventSet('${esc(x.code)}', 'DONE')">Đã tổ chức</button>` : ''}
              <button class="btn danger" data-on-click="eventSet('${esc(x.code)}', 'CANCELLED')">Hủy</button>`}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Chưa có yêu cầu thuê rạp / vé nhóm.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
const eventQuote = (code) => act(async () => {
  const x = (EVENTS.requests || []).find(e => e.code === code) || {};
  const r = await uiDialog({ title: 'Báo giá yêu cầu ' + code, confirmLabel: 'Gửi báo giá cho khách',
    body: kvHtml([['Khách', esc(x.contact_name || '')], ['Số khách', esc(x.guests || '')], ['Rạp / ngày', esc([x.cinema_name, x.date ? x.date.split('-').reverse().join('/') : '', x.time].filter(Boolean).join(' · '))]]),
    fields: [{ name: 'amount', label: 'Số tiền báo giá (đ)', required: true, inputmode: 'numeric', placeholder: 'VD: 3500000', value: x.quote_amount || '', validate: (v) => (Number(String(v).replace(/\D/g, '')) > 0 ? '' : 'Nhập số tiền lớn hơn 0') },
      { name: 'note', label: 'Ghi chú gửi khách (gói dịch vụ, phòng, giờ…)', multiline: true, value: x.quote_note || '' }] });
  if (!r) return CANCEL;
  await post('event_update', { code, status: 'QUOTED', quote_amount: r.amount.replace(/\D/g, ''), quote_note: r.note });
  await loadEvents();
}, 'Đã gửi báo giá cho khách');
const eventSet = (code, status) => act(async () => {
  let note = '';
  if (status === 'CANCELLED') {
    const r = await uiDialog({ title: 'Hủy yêu cầu ' + code + '?', body: 'Khách sẽ nhận email thông báo hủy.', confirmLabel: 'Hủy yêu cầu', cancelLabel: 'Không hủy', danger: true,
      fields: [{ name: 'note', label: 'Lý do hủy (nội bộ, khách không thấy)', multiline: true }] });
    if (!r) return CANCEL;
    note = r.note;
  }
  await post('event_update', { code, status, staff_note: note });
  await loadEvents();
}, status === 'CANCELLED' ? 'Đã hủy yêu cầu' : status === 'CONFIRMED' ? 'Đã chốt yêu cầu' : 'Đã cập nhật yêu cầu');

// Đánh giá phim (Đợt 2)
async function loadReviews() {
  const box = document.getElementById('reviews');
  try {
    const r = await api('admin?action=review_list');
    box.innerHTML = r.reviews.length ? `<table><thead><tr><th>Phim</th><th>Sao</th><th>Nội dung</th><th>Khách / đơn</th><th>Ngày</th><th></th></tr></thead><tbody>${
      r.reviews.map(x => `<tr class="${x.hidden ? 'inactive' : ''}"><td class="mono">${esc(x.movie_id)}</td><td>${'★'.repeat(x.rating)}</td><td>${esc(x.content || '—')}${x.hidden ? `<div class="hint">Đã ẩn${x.moderated_by ? ' bởi ' + esc(x.moderated_by) : ''}</div>` : ''}</td>
            <td>${esc(x.customer_name)}<div class="hint mono">${esc(x.order_code)}</div></td><td>${t(x.created_at)}</td>
            <td><button class="btn ${x.hidden ? 'ok' : 'danger'}" data-on-click="hideReview('${esc(x.id)}', ${!x.hidden})">${x.hidden ? 'Hiện lại' : 'Ẩn'}</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có đánh giá nào.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
const hideReview = (id, hidden) => act(async () => { await post('review_hide', { id, hidden }); await loadReviews(); });

function renderCskh() {
  // Đánh giá phim và thuê rạp chỉ tải khi đang mở tab CSKH (trước đây tải lại 15 giây/lần ở mọi tab)
  if (tab === 'cskh') { loadReviews(); loadEvents(); }
  badge('c-cskh', overview.tickets.filter(x => x.status === 'OPEN').length);
  renderTickets();
  renderWork();

  renderCsRefunds();
}

// ---- Đợt 7: hàng đợi phiếu, việc của tôi, khách hàng 360° ----
let tkFilter = 'OPEN';
// Nút chip lọc phiếu (data-on-click="setTkFilter('MINE')")
function setTkFilter(k) { tkFilter = k; renderTickets(); }
const TK_FILTERS = [
  ['OPEN', 'Đang mở', x => true], ['MINE', 'Của tôi', x => x.assigned_to === ME.id], ['UNASSIGNED', 'Chưa ai nhận', x => !x.assigned_to],
  ['WAITING', 'Chờ khách', x => x.status === 'WAITING_CUSTOMER'],
  ['PAY', 'Thanh toán / hoàn tiền', x => ['PAYMENT_REPORT', 'UNMATCHED_TX', 'DATA_MISMATCH', 'MANUAL_REVIEW'].includes(x.type)],
  ['GENERAL', 'Yêu cầu hỗ trợ', x => x.type === 'GENERAL']
];
const ageOf = (iso) => { const m = Math.max(0, (Date.now() - new Date(iso)) / 60000); return { m, label: m < 60 ? Math.round(m) + ' phút' : m < 1440 ? Math.round(m / 60) + ' giờ' : Math.round(m / 1440) + ' ngày', tone: m < 120 ? 'ok' : m < 1440 ? 'warn' : 'danger' }; };
function renderTickets() {
  const all = overview.tickets;
  document.getElementById('tk-chips').innerHTML = TK_FILTERS.map(([k, l, f]) => `<button class="chip ${tkFilter === k ? 'on' : ''}" data-on-click="setTkFilter('${k}')">${l}<span class="n">${all.filter(f).length}</span></button>`).join('');
  const q = val('tk-search').toLowerCase();
  const f = TK_FILTERS.find(x => x[0] === tkFilter)[2];
  const rows = all.filter(f).filter(x => !q || [x.code, x.order_code, x.summary, x.assigned_name, x.customer_name, x.name, x.phone, x.email].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || new Date(a.created_at) - new Date(b.created_at));
  document.getElementById('tickets').innerHTML = rows.length ? `<table><thead><tr><th>Phiếu</th><th>Chờ</th><th>Loại</th><th>Đơn</th><th>Nội dung</th><th>Người xử lý</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
    rows.map(x => { const a = ageOf(x.created_at); const last = (x.replies || []).slice(-1)[0]; return `<tr class="clickable" data-on-click="openTicket('${esc(x.code)}')">
          <td class="mono" style="white-space: nowrap;">${esc(x.code)}</td><td>${pill(a.label, a.tone)}</td><td>${pill(TK_LABEL[x.type] || x.type, x.type === 'GENERAL' ? 'info' : 'warn')}</td>
          <td class="mono">${esc(x.order_code || '—')}</td>
          <td>${esc(x.summary)}${last ? `<div class="hint">${last.from === 'STAFF' ? 'CSKH' : 'Khách'}: ${esc(String(last.message).slice(0, 90))}</div>` : ''}</td>
          <td>${x.assigned_name ? esc(x.assigned_name) + (x.assigned_to === ME.id ? ' (tôi)' : '') : '<span class="hint">chưa ai nhận</span>'}</td>
          <td>${pill(TK_STATUS[x.status] || x.status, x.status === 'OPEN' ? 'danger' : 'info')}</td>
          <td data-on-click="event.stopPropagation()" style="white-space: nowrap;">${!x.assigned_to ? `<button class="btn" data-on-click="assignTicket('${esc(x.code)}')">Nhận</button> ` : ''}<button class="btn primary" data-on-click="openTicket('${esc(x.code)}')">Mở</button></td></tr>`; }).join('')
  }</tbody></table>` : '<div class="empty">Không có phiếu nào trong mục này <i class=ph-confetti aria-hidden=true></i></div>';
}
function renderWork() {
  const tk = overview.tickets, rf = overview.refunds;
  const items = [
    [tk.filter(x => !x.assigned_to).length, 'Phiếu chưa ai nhận', "setTkFilter('UNASSIGNED'); scrollToCard('cs-queue')", 'warn'],
    [tk.filter(x => x.assigned_to === ME.id).length, 'Phiếu của tôi', "setTkFilter('MINE'); scrollToCard('cs-queue')", ''],
    [rf.filter(r => r.status === 'FORM_SUBMITTED').length, 'Hồ sơ hoàn tiền cần đối chiếu', "setCsFilter('FORM_SUBMITTED'); scrollToCard('cs-refund-card')", 'warn'],
    [rf.filter(r => r.status === 'ACC_RETURNED').length, 'Kế toán trả về', "setCsFilter('ACC_RETURNED'); scrollToCard('cs-refund-card')", 'danger'],
    [rf.filter(r => r.status === 'PAID_OUT').length, 'Kế toán đã chi – chờ xác nhận', "setCsFilter('PAID_OUT'); scrollToCard('cs-refund-card')", ''],
    [(EVENTS.requests || []).filter(e => e.status === 'NEW').length, 'Yêu cầu thuê rạp mới', "scrollToCard('events')", '']
  ];
  document.getElementById('cs-work').innerHTML = items.map(([n, l, go, tone]) => `<button type="button" class="kpi ${n && tone ? 'tone-' + tone : ''}" data-on-click="${go}"><b>${n}</b><span>${l}</span></button>`).join('');
}
const assignTicket = (code, release) => act(async () => { await post('ticket_assign', { ticket_code: code, release: !!release }); if (document.getElementById('drawer').classList.contains('open')) await openTicket(code); });
const TEMPLATES = [
  ['Đã nhận – đang kiểm tra', 'Chào {ten}, Beta Cinemas đã nhận phản ánh của bạn và đang kiểm tra. Chúng tôi sẽ phản hồi trong vòng 24 giờ.'],
  ['Đã đối soát – có vé', 'Chào {ten}, giao dịch của bạn đã được đối soát thành công. Vé điện tử đã có trong mục Tài khoản → Lịch sử đặt vé.'],
  ['Cần thêm thông tin', 'Chào {ten}, để hỗ trợ nhanh, bạn vui lòng gửi ảnh biên lai chuyển khoản (có mã giao dịch) và số tài khoản đã chuyển.'],
  ['Đã chuyển Kế toán hoàn tiền', 'Chào {ten}, yêu cầu hoàn tiền của bạn đã được chuyển Kế toán. Tiền về tài khoản trong 3–7 ngày làm việc tùy ngân hàng.'],
  ['Xin lỗi sự cố phòng chiếu', 'Chào {ten}, Beta Cinemas thành thật xin lỗi về trải nghiệm chưa tốt. Rạp đã ghi nhận và khắc phục. Mong được đón bạn lần sau.']
];
let TK = null;
function insertTemplate(sel) {
  if (!sel.value || !TEMPLATES[sel.value]) return;
  const name = String(((TK && TK.context && TK.context.customer) || {}).name || '').trim().split(/\s+/).pop() || 'bạn';
  const ta = document.getElementById('tk-reply');
  ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + TEMPLATES[sel.value][1].replace(/\{ten\}/g, () => name);
  sel.value = '';
  ta.focus();
}
async function openTicket(code, back) {
  const key = 'ticket:' + code;
  drawerNav(key, back);
  try {
  const tr = await api('admin?action=ticket_get&code=' + encodeURIComponent(code));
  if (drawerKey !== key) return;
  TK = tr.ticket;
  const x = TK, cx = x.context || {}, cust = cx.customer || {};
  document.getElementById('d-title').innerHTML = `Phiếu <span class="mono">${esc(x.code)}</span> ${pill(TK_STATUS[x.status] || x.status, x.status === 'OPEN' ? 'danger' : x.status === 'RESOLVED' ? 'ok' : 'info')}`;
  document.getElementById('d-body').innerHTML = `
        <div class="kv">
          <span>Loại</span><b>${esc(TK_LABEL[x.type] || x.type)}${cx.category_label ? ' · ' + esc(cx.category_label) : ''}</b>
          <span>Tạo lúc</span><span>${t(x.created_at)} (${ageOf(x.created_at).label} trước)</span>
          ${x.order_code ? `<span>Đơn</span><span><a href="#" class="mono" data-on-click="openOrder('${esc(x.order_code)}'); return false;">${esc(x.order_code)}</a></span>` : ''}
          ${cust.name || cx.phone ? `<span>Khách</span><span>${esc(cust.name || '')} ${cust.email ? '· ' + esc(cust.email) : ''} ${cx.phone ? '· ' + esc(cx.phone) : ''}${cust.id ? ` · <a href="#" data-on-click="openCustomer('${esc(cust.id)}'); return false;">hồ sơ 360°</a>` : ''}</span>` : ''}
          <span>Người xử lý</span><span>${x.assigned_name ? esc(x.assigned_name) : 'chưa ai nhận'} ${!x.assigned_to ? `<button class="btn" data-on-click="assignTicket('${esc(x.code)}')">Nhận xử lý</button>` : x.assigned_to === ME.id ? `<button class="btn" data-on-click="assignTicket('${esc(x.code)}', true)">Trả lại hàng đợi</button>` : ''}</span>
        </div>
        <div class="card" style="padding: 12px 14px;"><b>Nội dung</b><p style="margin: 6px 0 0; white-space: pre-line;">${esc(cx.description || x.summary || '')}</p>${cx.amount ? `<div class="hint">Số tiền khách khai: ${esc(cx.amount)}</div>` : ''}</div>
        <h3 style="font-size: 13px; color: #005198;">TRAO ĐỔI VỚI KHÁCH</h3>
        ${(x.replies || []).length ? (x.replies || []).map(r => `<div style="margin: 6px 0; padding: 8px 10px; border-radius: 8px; background: ${r.from === 'STAFF' ? '#eff6ff' : '#f8fafc'};"><b>${r.from === 'STAFF' ? 'CSKH ' : 'Khách '}${esc(r.name || '')}</b> <span class="hint">${t(r.at)}</span><div style="white-space: pre-line;">${esc(r.message)}</div></div>`).join('') : '<div class="hint">Chưa có trao đổi.</div>'}
        ${x.customer_id && x.status !== 'RESOLVED' ? `
          <div style="margin-top: 10px;">
            <select aria-label="Mẫu trả lời" data-on-change="insertTemplate(this)">
              <option value="">Chèn câu trả lời mẫu…</option>${TEMPLATES.map((m, i) => `<option value="${i}">${esc(m[0])}</option>`).join('')}
            </select>
            <textarea id="tk-reply" aria-label="Nội dung trả lời khách" rows="4" style="width: 100%; margin-top: 6px;" placeholder="Trả lời khách (khách xem ở trang Hỗ trợ và nhận email)"></textarea>
            <div class="row-actions" style="margin-top: 6px;">
              <label class="hint" style="display: flex; gap: 6px; align-items: center;"><input type="checkbox" id="tk-close"> Đóng phiếu sau khi gửi</label>
              <button class="btn primary" data-on-click="sendTicketReply()">Gửi trả lời</button>
            </div>
          </div>` : !x.customer_id ? '<div class="hint" style="margin-top: 8px;">Phiếu không gắn tài khoản khách – liên hệ khách qua số điện thoại / email ở trên.</div>' : ''}
        <h3 style="font-size: 13px; color: #005198; margin-top: 16px;">GHI CHÚ NỘI BỘ <small class="hint">khách không thấy</small></h3>
        ${(x.internal_notes || []).map(n => `<div class="hint" style="border-top: 1px dashed var(--line); padding: 4px 0;"><b>${esc(n.name)}</b> · ${t(n.at)}<br>${esc(n.note)}</div>`).join('') || '<div class="hint">Chưa có.</div>'}
        <div class="row-actions" style="margin-top: 6px;"><input id="tk-note" aria-label="Ghi chú nội bộ" placeholder="Ghi chú cho đồng nghiệp…" style="flex: 1;"><button class="btn" data-on-click="addTicketNote()">Lưu ghi chú</button></div>
        ${x.status !== 'RESOLVED' ? `<div class="row-actions" style="margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px;">
          <input id="tk-result" aria-label="Kết quả xử lý" placeholder="Kết quả xử lý (bắt buộc khi đóng)" style="flex: 1;"><button class="btn ok" data-on-click="closeTicket()">Đóng phiếu</button></div>` : `<div class="hint" style="margin-top: 12px;">Đã đóng${x.note ? ': ' + esc(x.note) : ''}</div>`}`;
  showDrawer();
  } catch (e) { if (drawerKey === key) toast('Không mở được phiếu ' + code + ': ' + e.message, 'danger'); }
}
const sendTicketReply = () => act(async () => {
  const message = val('tk-reply');
  if (message.length < 2) { document.getElementById('tk-reply').focus(); throw new Error('Nhập nội dung trả lời trước khi gửi'); }
  await post('ticket_reply', { ticket_code: TK.code, message, close: document.getElementById('tk-close').checked });
  await openTicket(TK.code, true);
}, 'Đã gửi trả lời cho khách');
const addTicketNote = () => act(async () => {
  if (val('tk-note').length < 2) { document.getElementById('tk-note').focus(); throw new Error('Nhập nội dung ghi chú'); }
  await post('ticket_note', { ticket_code: TK.code, note: val('tk-note') }); await openTicket(TK.code, true);
}, 'Đã lưu ghi chú nội bộ');
const closeTicket = () => act(async () => {
  const note = val('tk-result');
  if (note.length < 3) { document.getElementById('tk-result').focus(); throw new Error('Ghi kết quả xử lý (ít nhất 3 ký tự) trước khi đóng phiếu'); }
  await post('resolve_ticket', { ticket_code: TK.code, note });
  closeDrawer();
}, 'Đã đóng phiếu');
async function searchCustomers() {
  const box = document.getElementById('cu-results');
  try {
    const r = await api('admin?action=customer_search&q=' + encodeURIComponent(val('cu-q')));
    box.innerHTML = r.customers.length ? `<table><thead><tr><th>Khách hàng</th><th>Email</th><th>SĐT</th><th>Thành viên từ</th><th></th></tr></thead><tbody>${
      r.customers.map(c => `<tr class="clickable ${c.deleted ? 'inactive' : ''}" data-on-click="openCustomer('${esc(c.id)}')"><td><b>${esc(c.full_name)}</b>${c.deleted ? ' ' + pill('Đã xóa tài khoản', 'muted') : ''}</td><td>${esc(c.email)}</td><td class="mono">${esc(c.phone || '')}</td><td>${t(c.created_at)}</td><td><button class="btn primary">Xem</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Không tìm thấy khách hàng phù hợp.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function openCustomer(id, back) {
  const key = 'cust:' + id;
  drawerNav(key, back);
  try {
  const d = await api('admin?action=customer_detail&id=' + encodeURIComponent(id));
  if (drawerKey !== key) return;
  const c = d.customer, s = d.stats;
  const PAIDST = ['CONFIRMED', 'CONFIRMED_LATE'];
  document.getElementById('d-title').innerHTML = `Khách hàng · ${esc(c.full_name)}${c.deleted ? ' ' + pill('Đã xóa tài khoản', 'muted') : ''}`;
  document.getElementById('d-body').innerHTML = `
        <div class="kv">
          <span>Email / SĐT</span><b>${esc(c.email)} · <span class="mono">${esc(c.phone || '—')}</span></b>
          <span>Thành viên từ</span><span>${t(c.created_at)}${c.birthday ? ' · sinh ' + esc(c.birthday.split('-').reverse().join('/')) : ''}</span>
          <span>Email ưu đãi</span><span>${c.marketing_opt_in ? 'Đồng ý nhận' : 'Không nhận'}</span>
          ${d.points ? `<span>Beta Club</span><span>Hạng <b>${esc(d.points.tier)}</b> · ${d.points.balance} điểm${d.points.expiring_soon ? ' · ' + d.points.expiring_soon + ' điểm sắp hết hạn' : ''}</span>` : ''}
        </div>
        <div class="kpis">${[[s.paid_orders + '/' + s.orders, 'Đơn đã xuất vé'], [vnd(s.spend), 'Tổng chi tiêu'], [s.refunds, 'Hồ sơ hoàn tiền'], [s.open_tickets, 'Phiếu đang mở']].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
        <h3 style="font-size: 13px; color: #005198;">ĐƠN HÀNG</h3>
        ${d.orders.length ? `<table><thead><tr><th>Đơn</th><th>Nội dung</th><th>Giá trị</th><th>Trạng thái</th><th></th></tr></thead><tbody>${d.orders.map(o => `<tr>
          <td class="mono"><a href="#" data-on-click="openOrder('${esc(o.code)}'); return false;">${esc(o.code)}</a><div class="hint">${t(o.created_at)}</div></td>
          <td>${o.kind === 'FNB' ? 'Bắp nước · ' + esc(o.cinema) : esc(o.movie_key) + '<div class="hint">' + esc(o.cinema) + ' · ' + esc(o.show_time) + ' ' + esc(o.show_date) + ' · ghế ' + esc(o.seats.join(', ')) + '</div>'}</td>
          <td>${vnd(o.total)}</td><td>${pill(o.label, STATUS_TONE[o.status])}</td>
          <td>${PAIDST.includes(o.status) && !c.deleted ? `<button class="btn" data-on-click="staffResend('${esc(o.code)}', this)"><i class=ph-envelope aria-hidden=true></i> Gửi lại vé</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có đơn.</div>'}
        ${d.refunds.length ? `<h3 style="font-size: 13px; color: #005198; margin-top: 14px;">HOÀN TIỀN</h3><table><tbody>${d.refunds.map(r => `<tr><td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.order_code)}</td><td>${vnd(r.amount)}</td><td>${pill(RF_LABEL[r.status] || r.status, RF_TONE[r.status])}</td></tr>`).join('')}</tbody></table>` : ''}
        ${d.tickets.length ? `<h3 style="font-size: 13px; color: #005198; margin-top: 14px;">PHIẾU HỖ TRỢ</h3><table><tbody>${d.tickets.map(x => `<tr class="clickable" data-on-click="openTicket('${esc(x.code)}')"><td class="mono">${esc(x.code)}</td><td>${esc(x.summary || '')}</td><td>${pill(TK_STATUS[x.status] || (x.status === 'RESOLVED' ? 'Đã đóng' : x.status), x.status === 'RESOLVED' ? 'ok' : 'warn')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${d.reviews.length ? `<h3 style="font-size: 13px; color: #005198; margin-top: 14px;">ĐÁNH GIÁ PHIM</h3>${d.reviews.map(r => `<div class="hint">${'★'.repeat(r.rating)} ${esc(r.movie_id)}${r.hidden ? ' (đã ẩn)' : ''}: ${esc(r.content || '')}</div>`).join('')}` : ''}
        ${d.invoices.length ? `<h3 style="font-size: 13px; color: #005198; margin-top: 14px;">HÓA ĐƠN</h3>${d.invoices.map(i => `<div class="hint mono">${esc(i.order_code)} · ${esc(i.status)} ${esc(i.company_name || '')} ${esc(i.invoice_no || '')}</div>`).join('')}` : ''}`;
  showDrawer();
  } catch (e) { if (drawerKey === key) toast('Không mở được hồ sơ khách: ' + e.message, 'danger'); }
}
async function staffResend(code, btn) {
  btn.disabled = true;
  try { const r = await post('staff_resend_ticket', { code }); btn.textContent = r.sent ? 'Đã gửi tới ' + r.email : 'Đã ghi nhận (email chưa cấu hình)'; }
  catch (e) { toast(e.message, 'danger'); btn.disabled = false; }
}

function renderCsRefunds() {
  const all = overview.refunds.filter(r => MANUAL.includes(r.status));
  const q = document.getElementById('cs-search').value.trim().toLowerCase();
  document.getElementById('cs-chips').innerHTML = CS_FILTERS.map(([key, label, sts]) => {
    const n = all.filter(r => sts.includes(r.status)).length;
    return `<button class="chip ${csFilter === key ? 'on' : ''} ${key === 'ACC_RETURNED' && n ? 'alert-chip' : ''}" data-on-click="setCsFilter('${key}')">${label}<span class="n">${n}</span></button>`;
  }).join('');
  const sts = CS_FILTERS.find(f => f[0] === csFilter)[2];
  const order = { ACC_RETURNED: 0, FORM_SUBMITTED: 1, PAID_OUT: 2, MANUAL_REVIEW: 3, CS_APPROVED: 4, DONE: 5 };
  const rf = all
    .filter(r => sts.includes(r.status))
    .filter(r => !q || [r.code, r.order_code, r.acc_number, r.acc_name, r.bank_name].join(' ').toLowerCase().includes(q))
    .sort((x, y) => (order[x.status] - order[y.status]) || (new Date(x.created_at) - new Date(y.created_at)));
  // Bỏ chọn những hồ sơ không còn gửi được
  for (const c of [...selected]) { const r = all.find(x => x.code === c); if (!r || !['FORM_SUBMITTED', 'ACC_RETURNED'].includes(r.status)) selected.delete(c); }
  const sendable = (r) => ['FORM_SUBMITTED', 'ACC_RETURNED'].includes(r.status);
  const anySendable = rf.some(sendable);
  csVisible = rf.filter(sendable).map(r => r.code);
  const allOn = csVisible.length > 0 && csVisible.every(c => selected.has(c));
  document.getElementById('cs-refunds').innerHTML = rf.length ? `<table><thead><tr>
          <th style="width: 28px;">${anySendable ? `<input type="checkbox" aria-label="Chọn tất cả hồ sơ đang hiện" title="Chọn tất cả hồ sơ đang hiện" ${allOn ? 'checked' : ''} data-on-change="toggleAll(this.checked)">` : ''}</th>
          <th>Hồ sơ</th><th>Đơn</th><th>Số tiền</th><th>Tình trạng</th><th>Tài khoản nhận</th><th>Thao tác</th></tr></thead><tbody>${
    rf.map(r => `<tr class="${r.status === 'ACC_RETURNED' ? 'returned' : ''}">
          <td>${sendable(r) ? `<input type="checkbox" aria-label="Chọn hồ sơ ${esc(r.code)}" ${selected.has(r.code) ? 'checked' : ''} data-on-change="toggleSel('${esc(r.code)}', this.checked)">` : ''}</td>
          <td class="mono">${esc(r.code)}${r.returned_count ? `<div class="hint">bị trả ${r.returned_count} lần</div>` : ''}</td>
          <td class="mono"><a href="#" data-on-click="openOrder('${esc(r.order_code)}'); return false;">${esc(r.order_code)}</a></td>
          <td><b>${vnd(r.amount)}</b><div class="hint">${esc(r.reason)}</div></td>
          <td>${pill(RF_LABEL[r.status], RF_TONE[r.status])}
            ${r.status === 'ACC_RETURNED' && r.acc_note ? `<div class="ret-note"><i class=ph-arrow-u-up-left aria-hidden=true></i> ${esc(r.acc_note)}</div>` : (r.cs_note ? `<div class="hint">${esc(r.cs_note)}</div>` : '')}</td>
          <td>${r.acc_number ? `${esc(r.bank_name)}<br><span class="mono">${esc(r.acc_number)}</span> · ${esc(r.acc_name)}${r.has_receipt ? ' · <i class=ph-receipt aria-hidden=true></i>' : ''}` : '<span class="hint">chưa có</span>'}</td>
          <td class="row-actions">${
        sendable(r) ? `<button class="btn" data-on-click="openOrder('${esc(r.order_code)}')">Đối chiếu</button>
              <button class="btn ok" data-on-click="sendOne('${esc(r.code)}')">${r.status === 'ACC_RETURNED' ? 'Gửi lại Kế toán' : 'Gửi Kế toán'}</button>
              <button class="btn warn" data-on-click="decide('${esc(r.code)}','NGOAI_LE')">Yêu cầu khách bổ sung</button>`
        : r.status === 'MANUAL_REVIEW' ? `<button class="btn" data-on-click="remind('${esc(r.code)}')"><i class=ph-envelope aria-hidden=true></i> Nhắc khách</button>`
        : r.status === 'PAID_OUT' ? `<button class="btn ok" data-on-click="confirmDone('${esc(r.code)}')">Xác nhận hoàn tất</button>`
        : r.status === 'CS_APPROVED' ? '<span class="hint">Đang chờ Kế toán kiểm tra</span>'
        : `<span class="hint">Mã GD ${esc(r.refund_ref || '')}</span>`
      }</td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Không có hồ sơ nào trong mục này.</div>';
  document.getElementById('sel-count').textContent = selected.size;
  document.getElementById('btn-send-acc').disabled = !selected.size;
}

function toggleSel(code, on) { on ? selected.add(code) : selected.delete(code); renderCsRefunds(); }
function toggleAll(on) {
  csVisible.forEach(c => on ? selected.add(c) : selected.delete(c));
  renderCsRefunds();
}

async function sendCodes(codes) {
  const sum = codes.reduce((s, c) => s + Number(rfOf(c).amount || 0), 0);
  // Không điền sẵn câu "biên lai khớp…": nhân viên phải tự ghi điều mình đã kiểm tra
  const note = await uiPrompt({ title: `Gửi ${codes.length} hồ sơ cho Kế toán`, body: kvHtml([['Hồ sơ', `<span class="mono">${esc(codes.join(', '))}</span>`], ['Tổng tiền hoàn', vnd(sum)]]),
    label: 'Ghi chú đối chiếu (tùy chọn)', multiline: true, placeholder: 'VD: Đã đối chiếu biên lai với sổ cái ngân hàng, STK khớp tên khách', confirmLabel: 'Gửi Kế toán' });
  if (note === null) return CANCEL;
  const r = await post('send_to_accounting', { refund_codes: codes, note });
  const bad = r.results.filter(x => !x.ok);
  codes.forEach(c => selected.delete(c));
  if (bad.length) toast(`Đã gửi Kế toán ${r.sent}/${codes.length} hồ sơ.\nKhông gửi được: ` + bad.map(x => x.code + ' – ' + x.error).join('; '), 'warn', 0);
  else toast(`Đã gửi Kế toán ${r.sent} hồ sơ.`);
}
const sendSelected = () => act(() => sendCodes([...selected]));
const sendOne = (code) => act(() => sendCodes([code]));

// ---------------- KẾ TOÁN ----------------
// Hóa đơn điện tử (Đợt 4)
async function loadInvoices() {
  const box = document.getElementById('invoices');
  try {
    const r = await api('admin?action=invoice_list' + (val('inv-status') ? '&status=' + val('inv-status') : ''));
    document.getElementById('inv-sub').textContent = 'Khách gửi trong ' + r.hours + ' giờ sau khi thanh toán · nhà cung cấp: ' + (r.provider === 'MANUAL' ? 'chưa kết nối (nhập số hóa đơn thủ công)' : r.provider);
    box.innerHTML = r.requests.length ? `<table><thead><tr><th>Đơn</th><th>Người mua</th><th>Email</th><th>Số tiền</th><th>Trạng thái</th><th></th></tr></thead><tbody>${
      r.requests.map(x => `<tr><td class="mono">${esc(x.order_code)}<div class="hint">${t(x.created_at)}</div></td>
            <td>${x.buyer_type === 'COMPANY' ? `<b>${esc(x.company_name)}</b><div class="hint mono">MST ${esc(x.tax_code)}</div><div class="hint">${esc(x.address)}</div>` : `<b>${esc(x.buyer_name)}</b><div class="hint">Cá nhân</div>`}</td>
            <td>${esc(x.email)}</td><td>${vnd(x.amount)}</td>
            <td>${pill(r.statuses[x.status] || x.status, x.status === 'PENDING' ? 'warn' : x.status === 'ISSUED' ? 'ok' : 'muted')}${x.invoice_no ? `<div class="hint">Số ${esc(x.invoice_no)}${x.invoice_series ? ' · ' + esc(x.invoice_series) : ''}</div>` : ''}${x.note ? `<div class="hint">${esc(x.note)}</div>` : ''}</td>
            <td style="white-space: nowrap;">${x.status === 'PENDING' ? `<button class="btn ok" data-on-click="issueInvoice('${esc(x.order_code)}')">Đã xuất</button> <button class="btn danger" data-on-click="cancelInvoice('${esc(x.order_code)}')">Hủy</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Không có yêu cầu hóa đơn.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
function issueInvoice(code) {
  document.getElementById('iv-code').textContent = code;
  ['iv-no', 'iv-series', 'iv-url'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('iv-err').textContent = '';
  document.getElementById('inv-dlg').showModal();
}
async function submitInvoice() {
  try {
    await post('invoice_issue', { order_code: document.getElementById('iv-code').textContent, invoice_no: val('iv-no'), invoice_series: val('iv-series'), lookup_url: val('iv-url') });
    document.getElementById('inv-dlg').close();
    await loadInvoices(); loadAccSummary();
  } catch (e) { document.getElementById('iv-err').textContent = e.message; }
}
async function submitInvoiceBulk() {
  const lines = val('ib-text').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = document.getElementById('ib-err');
  let ok = 0; const bad = [];
  for (const l of lines) {
    const [code, no, series, url] = l.split(/\t|,|;/).map(s => (s || '').trim());
    try { await post('invoice_issue', { order_code: code.toUpperCase(), invoice_no: no, invoice_series: series || '', lookup_url: url || '' }); ok++; }
    catch (e) { bad.push(code + ': ' + e.message); }
  }
  out.style.color = bad.length ? '#b91c1c' : '#15803d';
  out.textContent = `Đã nhập ${ok}/${lines.length} hóa đơn.` + (bad.length ? '\n' + bad.join('\n') : '');
  if (!bad.length) document.getElementById('ib-text').value = '';
  await loadInvoices(); loadAccSummary();
}
const cancelInvoice = (code) => act(async () => {
  const reason = await uiPrompt({ title: 'Hủy yêu cầu hóa đơn · ' + code, label: 'Lý do không xuất được (gửi cho khách)', multiline: true, required: true, confirmLabel: 'Hủy yêu cầu', danger: true });
  if (reason === null) return CANCEL;
  await post('invoice_cancel', { order_code: code, reason });
  await loadInvoices();
}, 'Đã hủy yêu cầu hóa đơn');
async function downloadInvoices() {
  try {
    const r = await fetch(API + 'admin?action=invoice_list&format=csv' + (val('inv-status') ? '&status=' + val('inv-status') : ''), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = 'yeu-cau-hoa-don.csv';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Không xuất được: ' + e.message, 'danger'); }
}

// ---- Đợt 7: công cụ Kế toán ----
const ktSel = new Set();
function ktSync() {
  document.getElementById('kt-sel-count').textContent = ktSel.size;
  document.getElementById('kt-sel-n').textContent = ktSel.size ? ktSel.size + ' hồ sơ chọn' : 'tất cả';
  document.getElementById('kt-batch-btn').disabled = !ktSel.size;
  const sum = [...ktSel].reduce((s, c) => s + Number(rfOf(c).amount || 0), 0);
  const se = document.getElementById('kt-sel-sum'); if (se) se.textContent = ktSel.size ? 'Đã chọn ' + ktSel.size + ' hồ sơ · tổng ' + vnd(sum) : '';
  const pb = document.getElementById('kt-payout-btn'); if (pb) pb.disabled = !(overview && overview.refunds.some(r => r.status === 'CS_APPROVED' && !mineSent(r)));
}
function ktToggle(code, on) { on ? ktSel.add(code) : ktSel.delete(code); ktSync(); }
function ktToggleAll(on) { overview.refunds.filter(r => r.status === 'CS_APPROVED' && !mineSent(r)).forEach(r => on ? ktSel.add(r.code) : ktSel.delete(r.code)); renderKetoan(); }
async function downloadFile(path, fallbackName) {
  try {
    const r = await fetch(API + path, { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || fallbackName;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Không tải được: ' + e.message, 'danger'); }
}
const downloadPayout = () => downloadFile('admin?action=payout_csv&codes=' + encodeURIComponent([...ktSel].join(',')), 'bang-ke-chuyen-khoan.csv');
const downloadDays = () => downloadFile('admin?action=day_list&format=csv', 'so-quy-theo-ngay.csv');
function openPaidBatch() {
  const rows = overview.refunds.filter(r => ktSel.has(r.code));
  document.getElementById('pd-count').textContent = rows.length;
  document.getElementById('pd-err').textContent = '';
  document.getElementById('pd-same').checked = false; document.getElementById('pd-batch').disabled = true; document.getElementById('pd-batch').value = '';
  document.getElementById('pd-rows').innerHTML = `<table><thead><tr><th>Hồ sơ</th><th>Chuyển tới</th><th>Số tiền</th><th>Mã GD</th></tr></thead><tbody>${rows.map(r => `<tr>
        <td class="mono">${esc(r.code)}</td><td>${esc(r.bank_name)} · <span class="mono">${esc(r.acc_number)}</span><div class="hint">${esc(r.acc_name)}</div></td><td><b>${vnd(r.amount)}</b></td>
        <td><input class="mono pd-ref" data-code="${esc(r.code)}" placeholder="FT…" style="width: 150px;"></td></tr>`).join('')}</tbody></table>
        <div class="hint" style="margin-top: 6px;">Tổng: <b>${vnd(rows.reduce((s, r) => s + Number(r.amount || 0), 0))}</b></div>`;
  document.getElementById('paid-dlg').showModal();
}
async function submitPaidBatch() {
  const same = document.getElementById('pd-same').checked;
  const batch = val('pd-batch');
  const items = [...document.querySelectorAll('.pd-ref')].map(i => ({ refund_code: i.dataset.code, refund_ref: same ? batch : i.value.trim() }));
  const err = document.getElementById('pd-err');
  if (items.some(i => !i.refund_ref)) return (err.textContent = same ? 'Nhập mã giao dịch chung.' : 'Nhập mã giao dịch cho mọi hồ sơ (hoặc dùng mã chung).');
  try {
    const r = await post('accounting_paid_batch', { items });
    const bad = r.results.filter(x => !x.ok);
    r.results.filter(x => x.ok).forEach(x => ktSel.delete(x.code));
    if (bad.length) err.textContent = `Đã chi ${r.paid}/${items.length}. Không được:\n` + bad.map(x => x.code + ': ' + x.error).join('\n');
    else document.getElementById('paid-dlg').close();
    await load(); loadAccSummary();
  } catch (e) { err.textContent = e.message; }
}
async function loadAccSummary() {
  if (!can('report.view')) return;
  try {
    const s = await api('admin?action=acc_summary');
    document.getElementById('kt-kpis').innerHTML = [
      [s.pending_count + ' · ' + vnd(s.pending_amount), 'Hồ sơ chờ duyệt chi', s.pending_count ? 'warn' : ''],
      [s.paid_today_count + ' · ' + vnd(s.paid_today_amount), 'Đã chi hôm nay', ''],
      [s.invoices_pending, 'Hóa đơn chờ xuất', s.invoices_pending ? 'warn' : ''],
      [s.unmatched_count + ' · ' + vnd(s.unmatched_amount), 'Tiền vào chưa khớp đơn (chưa xử lý)', s.unmatched_count ? 'danger' : ''],
      [s.days_unclosed.length, 'Ngày chưa chốt sổ (7 ngày qua)', s.days_unclosed.length ? 'warn' : '']
    ].map(([v, l, tone]) => `<div class="kpi ${tone ? 'tone-' + tone : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
  } catch (e) { /* không chặn tab nếu lỗi */ }
}
let DAYS = [];
async function loadDays() {
  const box = document.getElementById('kt-days');
  try {
    const r = await api('admin?action=day_list');
    DAYS = r.days;
    const st = { OPEN: pill('Chưa chốt', 'warn'), TODAY: pill('Hôm nay', 'info'), CLOSED: pill('Đã chốt', 'ok'), CHANGED: pill('Phát sinh sau chốt', 'danger') };
    const head = '<thead><tr><th>Ngày</th><th>Tiền vào</th><th>Theo kênh</th><th>Chưa khớp</th><th>Doanh thu xuất vé</th><th>Đã hoàn</th><th>Kế toán đã chi</th><th>Hồ sơ hoàn mở</th><th>Trạng thái</th><th></th></tr></thead>';
    const row = (x) => `<tr class="${x.status === 'CHANGED' ? 'flag' : ''}"><td><b>${x.date.split('-').reverse().join('/')}</b></td><td><b>${vnd(x.received)}</b><div class="hint">${x.tx_count} GD</div></td>
            <td class="hint">${Object.entries(x.by_channel).filter(([, v]) => v).map(([k, v]) => esc(k) + ' ' + vnd(v)).join('<br>') || '—'}</td>
            <td>${x.unmatched ? `<b style="color: var(--danger-text);">${vnd(x.unmatched)}</b>` : '—'}</td><td>${vnd(x.revenue)}<div class="hint">${x.orders} đơn</div></td>
            <td>${vnd(x.refunded_auto + x.refunded_manual)}${x.refunded_manual ? `<div class="hint">thủ công ${vnd(x.refunded_manual)}</div>` : ''}</td><td>${x.payouts ? vnd(x.payouts) : '—'}</td><td>${x.refunds_open ? vnd(x.refunds_open) : '—'}</td>
            <td>${st[x.status]}${x.closing ? `<div class="hint">${esc(x.closing.closed_by)} · ${t(x.closing.closed_at)}</div>${x.closing.note ? `<div class="hint">${esc(x.closing.note)}</div>` : ''}` : ''}${x.status === 'CHANGED' ? `<div class="ret-note">Đổi: ${esc(x.changed.join(', '))}</div>` : ''}</td>
            <td>${x.status === 'OPEN' && can('refund.pay') ? `<button class="btn primary" data-on-click="openCloseDay('${x.date}')">Chốt sổ</button>` : ''}
              ${(x.status === 'CLOSED' || x.status === 'CHANGED') && r.can_reopen ? `<button class="btn" data-on-click="reopenDay('${x.date}')">Mở lại</button>` : ''}</td></tr>`;
    // Ngày không phát sinh gì (và không phải hôm nay / không đổi sau chốt) gom vào mục thu gọn cho dễ đọc
    const quiet = (x) => x.status !== 'TODAY' && x.status !== 'CHANGED' && !x.received && !x.revenue && !x.refunded_auto && !x.refunded_manual && !x.payouts && !x.refunds_open && !x.unmatched;
    const busy = r.days.filter(x => !quiet(x)), calm = r.days.filter(quiet);
    const calmOpen = calm.filter(x => x.status === 'OPEN').length;
    box.innerHTML = (busy.length ? `<table>${head}<tbody>${busy.map(row).join('')}</tbody></table>` : '<div class="empty">Không có ngày nào phát sinh giao dịch trong 31 ngày qua.</div>')
      + (calm.length ? `<details class="table-view"><summary>${calm.length} ngày không phát sinh giao dịch${calmOpen ? ' · ' + calmOpen + ' ngày chưa chốt' : ''}</summary><table>${head}<tbody>${calm.map(row).join('')}</tbody></table></details>` : '');
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
function openCloseDay(date) {
  const x = DAYS.find(d => d.date === date);
  document.getElementById('cd-date').textContent = date.split('-').reverse().join('/');
  document.getElementById('cd-date').dataset.date = date;
  document.getElementById('cd-sum').innerHTML = [['Tiền vào', vnd(x.received) + ' (' + x.tx_count + ' GD)'], ['Chưa khớp đơn', vnd(x.unmatched)], ['Doanh thu xuất vé', vnd(x.revenue)],
    ['Đã hoàn (tự động / thủ công)', vnd(x.refunded_auto) + ' / ' + vnd(x.refunded_manual)], ['Kế toán đã chi', vnd(x.payouts)], ['Tiền giữ lại (tiền vào − hoàn tự động − Kế toán đã chi)', vnd(x.net)], ['Hồ sơ hoàn còn mở', vnd(x.refunds_open)]]
    .map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  document.getElementById('cd-note').value = ''; document.getElementById('cd-err').textContent = '';
  document.getElementById('close-dlg').showModal();
}
async function submitCloseDay() {
  try {
    await post('day_close', { date: document.getElementById('cd-date').dataset.date, note: val('cd-note') });
    document.getElementById('close-dlg').close();
    await loadDays(); loadAccSummary();
  } catch (e) { document.getElementById('cd-err').textContent = e.message; }
}
const reopenDay = (date) => act(async () => {
  const reason = await uiPrompt({ title: 'Mở lại sổ ngày ' + date.split('-').reverse().join('/'), body: 'Sổ đã chốt sẽ mở để Kế toán chốt lại. Lý do được ghi vào nhật ký thao tác.',
    label: 'Lý do mở lại (bắt buộc)', multiline: true, required: true, minlength: 5, confirmLabel: 'Mở lại sổ', danger: true });
  if (reason === null) return CANCEL;
  await post('day_reopen', { date, note: reason });
  await loadDays(); loadAccSummary();
}, 'Đã mở lại sổ ngày ' + date.split('-').reverse().join('/'));
async function loadUnmatched() {
  const box = document.getElementById('kt-unmatched');
  try {
    const r = await api('admin?action=unmatched_list');
    box.innerHTML = r.rows.length ? `<table><thead><tr><th>Thời điểm</th><th>Mã GD</th><th>Số tiền</th><th>Nội dung khách ghi</th><th>Phiếu CSKH</th></tr></thead><tbody>${
      r.rows.map(x => `<tr class="${x.resolved ? 'inactive' : 'flag'}"><td>${t(x.transaction_date)}</td><td class="mono">${esc(x.reference_code)}<div class="hint">${esc(x.gateway || '')}</div></td><td><b>${vnd(x.amount)}</b></td>
            <td>${esc(x.content || '')}</td><td>${x.ticket_code ? `<span class="mono">${esc(x.ticket_code)}</span> ${pill(x.resolved ? 'Đã xử lý' : 'Đang xử lý', x.resolved ? 'ok' : 'warn')}${x.ticket_note ? `<div class="hint">${esc(x.ticket_note)}</div>` : ''}` : '<span class="hint">chưa có phiếu</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Không có khoản tiền nào không khớp đơn trong 30 ngày.</div>';
  } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

// Phần nặng (sổ ngày, tiền không khớp, hóa đơn) chỉ tải khi đang mở tab Kế toán và tối đa 1 lần mỗi phút
let ktHeavyAt = 0;
const REASON_VI = { LATE: 'Chuyển sau hạn giữ ghế', SEAT_TAKEN: 'Ghế đã bán cho khách khác', NEAR_SHOWTIME: 'Sát giờ chiếu', SHORT: 'Chuyển thiếu, hết giờ', EXCESS: 'Chuyển thừa', DUPLICATE: 'Chuyển trùng', MISMATCH: 'Sai số tiền' };
const reasonVi = (k) => REASON_VI[k] || k || '';
// Nguyên tắc 2 người: người gửi hồ sơ sang Kế toán không được tự duyệt chi (máy chủ cũng chặn)
const mineSent = (r) => !!r && ((r.review_log || []).filter(x => x.role === 'NHÂN VIÊN').pop() || {}).actor_id === (ME && ME.id);
function renderKetoan() {
  if (can('report.view') && tab === 'ketoan') {
    loadAccSummary();
    if (Date.now() - ktHeavyAt > 60000) { ktHeavyAt = Date.now(); loadInvoices(); loadDays(); loadUnmatched(); }
  }
  setTimeout(ktSync);
  const rf = overview.refunds.filter(r => r.status === 'CS_APPROVED')
    .sort((x, y) => new Date(x.reconciled_at || x.created_at) - new Date(y.reconciled_at || y.created_at));
  badge('c-ketoan', rf.length);
  const sentBy = (r) => { const l = (r.review_log || []).filter(x => x.role === 'NHÂN VIÊN').pop(); return l ? `${esc(l.actor)} · ${t(l.at)}` : ''; };
  for (const c of [...ktSel]) { const r = rf.find(x => x.code === c); if (!r || mineSent(r)) ktSel.delete(c); }
  // Giữ mã giao dịch đang gõ khi bảng vẽ lại
  const keep = {}, a0 = document.activeElement, focusId = a0 && a0.id && a0.id.startsWith('ref-') ? a0.id : null;
  document.querySelectorAll('#kt-refunds input[id^="ref-"]').forEach(i => { if (i.value) keep[i.id] = i.value; });
  const selectable = rf.filter(r => !mineSent(r));
  document.getElementById('kt-refunds').innerHTML = rf.length ? `<table><thead><tr><th style="width: 28px;"><input type="checkbox" aria-label="Chọn tất cả hồ sơ chờ chi" data-on-change="ktToggleAll(this.checked)" ${selectable.length && selectable.every(r => ktSel.has(r.code)) ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}></th><th>Hồ sơ</th><th>Đơn</th><th>Số tiền hoàn</th><th>Tiền thực nhận</th><th>Chuyển tới</th><th>Người lập (CSKH)</th><th>Kiểm tra & duyệt</th></tr></thead><tbody>${
    rf.map(r => { const mine = mineSent(r), age = ageOf(r.reconciled_at || r.created_at); return `<tr class="${r.received != null && r.amount > r.received ? 'flag' : ''}">
          <td><input type="checkbox" aria-label="Chọn hồ sơ ${esc(r.code)}" ${ktSel.has(r.code) ? 'checked' : ''} ${mine ? 'disabled title="Hồ sơ do bạn gửi – không tự duyệt"' : ''} data-on-change="ktToggle('${esc(r.code)}', this.checked)"></td>
          <td class="mono">${esc(r.code)}<div>${pill('chờ ' + age.label, age.tone)}</div>${r.returned_count ? `<div class="hint">gửi lại lần ${r.returned_count + 1}</div>` : ''}</td>
          <td class="mono"><a href="#" data-on-click="openOrder('${esc(r.order_code)}'); return false;">${esc(r.order_code)}</a></td>
          <td><b>${vnd(r.amount)}</b><div class="hint">${esc(reasonVi(r.reason))}</div></td>
          <td>${vnd(r.received)}${r.received != null && r.amount > r.received ? '<div class="ret-note"><i class=ph-warning aria-hidden=true></i> Hoàn nhiều hơn tiền nhận</div>' : ''}</td>
          <td>${esc(r.bank_name)}<br><span class="mono">${esc(r.acc_number)}</span> · ${esc(r.acc_name)}</td>
          <td>${sentBy(r)}${r.cs_note ? `<div class="hint">${esc(r.cs_note)}</div>` : ''}</td>
          <td><div class="row-actions">
              <button class="btn" data-on-click="openOrder('${esc(r.order_code)}')"><i class=ph-receipt aria-hidden=true></i> Biên lai & sổ cái</button>
            </div>
            ${mine ? `<div class="ret-note" style="margin-top: 8px;"><i class=ph-lock-key aria-hidden=true></i> Bạn là người gửi hồ sơ này – cần một Kế toán khác duyệt chi (nguyên tắc 2 người).</div>` : `
            <div class="row-actions" style="margin-top: 6px;">
              <input aria-label="Mã giao dịch chuyển hoàn của hồ sơ ${esc(r.code)}" id="ref-${esc(r.code)}" class="mono" placeholder="Mã GD chuyển hoàn FT…" style="width: 180px;">
              <button class="btn ok" data-on-click="paid('${esc(r.code)}')"><i class=ph-check aria-hidden=true></i> Đạt – Đã chi</button>
            </div>`}
            <div class="row-actions" style="margin-top: 6px;"><button class="btn danger" data-on-click="openReject('${esc(r.code)}')"><i class=ph-arrow-u-up-left aria-hidden=true></i> Không đạt – Trả về</button></div></td></tr>`; }).join('')
  }</tbody></table>` : '<div class="empty">Không có hồ sơ nào đang chờ Kế toán kiểm tra.</div>';
  Object.entries(keep).forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
  if (focusId) { const i = document.getElementById(focusId); if (i) i.focus(); }
}

// Hộp thoại "Không đạt – Trả về nhân viên"
let rejectCode = null;
function openReject(code) {
  const r = overview.refunds.find(x => x.code === code);
  rejectCode = code;
  document.getElementById('rj-code').textContent = code;
  document.getElementById('rj-info').textContent = `Đơn ${r.order_code} · hoàn ${vnd(r.amount)} tới ${r.bank_name} ${r.acc_number} (${r.acc_name})`;
  document.getElementById('rj-reason').innerHTML = '<option value="">— Chọn lý do —</option>' +
    Object.entries(overview.return_reasons || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  document.getElementById('rj-note').value = '';
  document.getElementById('rj-err').textContent = '';
  document.getElementById('reject-dlg').showModal();
}
async function submitReject() {
  const reason = document.getElementById('rj-reason').value;
  const note = document.getElementById('rj-note').value.trim();
  const err = document.getElementById('rj-err');
  if (!reason) return (err.textContent = 'Chọn lý do không đạt.');
  try {
    await post('accounting_reject', { refund_code: rejectCode, reason, note });
    document.getElementById('reject-dlg').close();
    await load();
  } catch (e) {
    err.textContent = e.message;
  }
}

function dates() {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const f = document.getElementById('r-from'), to = document.getElementById('r-to');
  if (!f.value) f.value = today; if (!to.value) to.value = today;
  return `from=${f.value}&to=${to.value}`;
}
const ORDER_STATUS_VI = { PENDING: 'Chờ thanh toán', CONFIRMED: 'Đã xuất vé', CONFIRMED_LATE: 'Đã cấp vé bù', EXPIRED: 'Chờ đối soát tiền', REFUND_REQUESTED: 'Đang hoàn tiền', REFUNDED: 'Đã hoàn tiền', MANUAL_REVIEW: 'Chờ xử lý thủ công', CANCELLED: 'Đã hủy', FAILED: 'Thanh toán thất bại', UNMATCHED: 'Không khớp đơn' };
async function loadReport() {
  const tbx = document.getElementById('r-table');
  let r;
  try { r = await api('admin?action=report&' + dates()); }
  catch (e) { tbx.innerHTML = `<div class="alert danger">Không tải được báo cáo: ${esc(e.message)} <button type="button" class="btn" data-on-click="loadReport()">Thử lại</button></div>`; return; }
  const s = r.summary;
  const g = (name) => (s.byGroup[name] || { count: 0 }).count;
  const lech = g('Còn lệch – chờ xử lý') + g('Tiền không khớp đơn');
  document.getElementById('r-kpis').innerHTML = [
    ['Khớp thành công', g('Khớp thành công')], ['Cấp vé bù', g('Cấp vé bù')], ['Đã hoàn tự động', g('Đã hoàn tự động')],
    ['Đã hoàn thủ công', g('Đã hoàn thủ công')], ['Còn lệch – chờ xử lý', lech, lech ? 'danger' : ''],
    ['Doanh thu vé', vnd(s.revenue)], ['Tiền thực nhận', vnd(s.received)], ['Đã hoàn', vnd(s.refunded)]
  ].map(([k, v, tone]) => `<div class="kpi ${tone ? 'tone-' + tone : ''}"><b>${v}</b><span>${k}</span></div>`).join('');
  tbx.innerHTML = r.rows.length ? `<table><thead><tr><th>Mã đơn</th><th>Nhóm</th><th>Trạng thái</th><th>Giá trị đơn</th><th>Thực nhận</th><th>Đã hoàn</th><th>Chờ hoàn</th><th>Chênh lệch</th><th>Mã GD</th><th>Cảnh báo</th></tr></thead><tbody>${
    r.rows.map(x => `<tr class="${x.flag === 'LỆCH' ? 'flag' : ''}"><td class="mono">${/^BC\d{6,}$/.test(x.code || '') ? `<a href="#" data-on-click="openOrder('${esc(x.code)}'); return false;">${esc(x.code)}</a>` : esc(x.code || '')}</td><td>${esc(x.group)}</td><td>${pill(ORDER_STATUS_VI[x.status] || x.status, STATUS_TONE[x.status])}</td>
          <td>${vnd(x.total)}</td><td>${vnd(x.received)}</td><td>${vnd(x.refunded)}</td><td>${vnd(x.refund_open)}</td><td><b>${vnd(x.diff)}</b></td><td class="mono">${esc(x.tx_refs)}</td>
          <td>${x.flag ? pill(x.flag, x.flag === 'LỆCH' ? 'danger' : 'warn') : ''}</td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Không có giao dịch trong khoảng thời gian này.</div>';
}
async function downloadCsv() {
  const r = await fetch(API + 'admin?action=report&format=csv&' + dates(), { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) { toast('Không tải được báo cáo', 'danger'); return; }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `doi-soat_${document.getElementById('r-from').value}_${document.getElementById('r-to').value}.csv`;
  a.click();
}

// ---------------- IT ----------------
// Vận hành (Đợt 5)
async function loadSystem() {
  try {
    const s = await api('admin?action=system_status');
    const since = (iso) => iso ? t(iso) + ' (' + Math.round((Date.now() - new Date(iso)) / 3600e3) + ' giờ trước)' : '<span style="color:#b91c1c">chưa ghi nhận</span>';
    document.getElementById('sys-status').innerHTML = [
      ['Cơ sở dữ liệu', esc(s.db)], ['Email', esc(s.mail)], ['Người nhận cảnh báo', s.alert_to ? s.alert_to + ' địa chỉ' : '<span style="color:#b91c1c">chưa có – tạo tài khoản Quản lý hoặc đặt ALERT_EMAILS</span>'],
      ['Job đối soát hằng ngày chạy lần cuối', since(s.last_cron)], ['Webhook / IPN thanh toán gần nhất', since(s.last_webhook)],
      ['Lỗi máy chủ 24 giờ qua', s.errors_24h ? '<b style="color:#b91c1c">' + s.errors_24h + '</b>' : '0'],
      ['Hồ sơ hoàn tiền thủ công', s.manual_refunds], ['Phiếu hỗ trợ đang mở', s.open_tickets], ['Đơn chờ thanh toán / đối soát', s.waiting_orders]
    ].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
    document.getElementById('sys-errors').innerHTML = (s.last_errors.length ? `<h3 style="font-size:14px;margin:8px 0">Lỗi gần nhất</h3><table><tbody>${s.last_errors.map(e => `<tr><td class="hint">${t(e.at)}</td><td class="mono">${esc(e.source)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table>` : '')
      + (s.recent_alerts.length ? `<h3 style="font-size:14px;margin:12px 0 8px">Cảnh báo đã gửi</h3><table><tbody>${s.recent_alerts.map(a => `<tr><td class="hint">${t(a.at)}</td><td><b>${esc(a.title)}</b><div class="hint">${esc(a.message)}</div></td></tr>`).join('')}</tbody></table>` : '');
  } catch (e) { document.getElementById('sys-status').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}
async function downloadBackup() {
  if (!(await uiConfirm({ title: 'Tải bản sao lưu toàn bộ dữ liệu?', body: 'File chứa <b>thông tin khách hàng</b> (tên, email, số điện thoại, đơn hàng). Lưu ở nơi an toàn, không gửi qua chat hay email.', confirmLabel: 'Tải bản sao lưu' }))) return;
  try {
    const r = await fetch(API + 'admin?action=backup', { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'beta-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Không tải được bản sao lưu: ' + e.message, 'danger'); }
}

function renderIt() {
  if (tab === 'it') loadSystem();
  // Bản thật đã tắt Sandbox (máy chủ trả 403) → ẩn thẻ để khỏi bấm nhầm
  document.getElementById('it-sandbox').hidden = overview.sandbox === false;
  const al = overview.alerts;
  badge('c-it', al.filter(a => a.level === 'danger').length);
  document.getElementById('alerts').innerHTML = al.map(a => `<div class="alert ${a.level}">${a.level === 'danger' ? '<i class=ph-siren aria-hidden=true></i>' : a.level === 'warn' ? '<i class=ph-warning aria-hidden=true></i>' : '<i class=ph-info aria-hidden=true></i>'} ${esc(a.text)}</div>`).join('');
  const c = overview.config, m = (ms) => ms >= 3600e3 ? ms / 3600e3 + ' giờ' : ms >= 60e3 ? ms / 60e3 + ' phút' : ms / 1e3 + ' giây';
  document.getElementById('config').innerHTML = [
    ['Giữ ghế (Seat Lock)', m(c.HOLD_MS)], ['Chờ Webhook', m(c.WEBHOOK_WAIT_MS)], ['Short Polling', `${m(c.SHORT_POLL_MS)}/lần × ${c.SHORT_POLL_COUNT}`],
    ['Final Check', m(c.FINAL_CHECK_MS) + '/lần'], ['Lịch tra cứu Tầng 1', overview.schedule.map(s => m(s.at)).join(' · ') + ' · 10 phút (chốt)'],
    ['Job Tầng 2 / gửi lại Refund', m(c.JOB_MS) + '/lần'], ['Cửa sổ ScanList', m(c.SCAN_WINDOW_MS)], ['Hạn tự hoàn', m(c.REFUND_DEADLINE_MS)],
    ['Cấp vé bù khi còn', '≥ ' + m(c.MIN_BEFORE_SHOW_MS) + ' trước giờ chiếu'], ['Cảnh báo khi API lỗi liên tiếp', c.ALERT_CONSECUTIVE_ERRORS + ' lần']
  ].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  document.getElementById('orders').innerHTML = `<table><thead><tr><th>Mã đơn</th><th>Trạng thái</th><th>Ghế</th><th>Giá trị</th><th>Đã nhận</th><th>Tạo lúc</th></tr></thead><tbody>${
    overview.orders.map(o => `<tr class="clickable" tabindex="0" aria-label="Mở đơn ${esc(o.code)}" data-on-click="openOrder('${esc(o.code)}')" data-on-keydown="openOrderKey(event, '${esc(o.code)}')"><td class="mono">${esc(o.code)}</td><td>${pill(o.label, STATUS_TONE[o.status])}</td><td>${esc((o.seats || []).join(', '))}</td><td>${vnd(o.total)}</td><td>${vnd(o.paid_amount)}</td><td>${t(o.created_at)}</td></tr>`).join('')
  }</tbody></table>`;
  document.getElementById('logs').innerHTML = logTable(overview.logs);
}
const logTable = (logs) => logs.length ? `<table><thead><tr><th>Thời điểm</th><th>Đơn</th><th>API</th><th>Pha</th><th>Kết quả</th><th>Chi tiết</th></tr></thead><tbody>${
  logs.map(l => `<tr><td>${t(l.created_at)}</td><td class="mono">${esc(l.order_code)}</td><td>${esc(l.api)}</td><td>${esc(l.phase)}</td>
        <td>${pill(l.result, l.result === 'SUCCESS' || l.result === 'OK' ? 'ok' : l.result === 'ERROR' || l.result === 'MISMATCH' || l.result === 'REJECTED' ? 'danger' : 'warn')}</td>
        <td class="mono" style="font-size: 12px; max-width: 320px; overflow-wrap: anywhere;">${esc(JSON.stringify(l.detail || {}))}</td></tr>`).join('')
}</tbody></table>` : '<div class="empty">Chưa có nhật ký.</div>';

const runJob = (force) => act(async () => {
  if (force && !(await uiConfirm({ title: 'Kiểm tra ngay mọi đơn hết hạn giữ ghế?', confirmLabel: 'Chạy ngay',
    body: 'Hệ thống tra cứu ngân hàng cho mọi đơn EXPIRED mà không chờ tới lịch – có thể tự cấp vé bù hoặc tạo lệnh hoàn tiền. Thường chỉ dùng khi xử lý sự cố.' }))) return CANCEL;
  const r = await post('run_job', { force });
  document.getElementById('job-result').textContent = `Đã quét ${r.pending} đơn chờ thanh toán, ${r.expired} đơn hết hạn giữ ghế, ${r.refunds} lệnh hoàn. ${r.changed.length ? 'Thay đổi: ' + r.changed.join(' | ') : 'Không có thay đổi.'}`;
  return r;
}, (r) => 'Job đối soát xong: ' + (r.changed.length ? r.changed.length + ' thay đổi' : 'không có thay đổi'));

async function sb(scenario, extra = {}) {
  const code = document.getElementById('sb-code').value.trim().toUpperCase();
  try {
    const r = await fetch(API + 'simulate-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ scenario, order_code: code, ...extra }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    document.getElementById('sb-result').innerHTML = `<i class=ph-check aria-hidden=true></i> ${esc(j.description)}${j.order ? ` → ${pill(j.order.status_label, STATUS_TONE[j.order.status])}` : ''}`;
    await load();
  } catch (e) {
    document.getElementById('sb-result').textContent = '✗ ' + e.message;
  }
}

// ---------------- Thao tác ----------------
// Thao tác ghi dữ liệu: khóa nút đang bấm (chống bấm 2 lần), báo kết quả bằng thông báo nhỏ, rồi tải lại dữ liệu.
//   fn trả về CANCEL khi người dùng bấm Hủy trong hộp thoại -> không tải lại, không báo gì.
let acting = 0;
async function act(fn, okMsg) {
  const ev = window.event, a = document.activeElement;
  let btn = (ev && ev.target instanceof Element && ev.target.closest('button')) || (a && a.tagName === 'BUTTON' ? a : null);
  if (btn && btn.closest('dialog')) btn = null;
  if (btn) { if (btn.getAttribute('aria-busy') === 'true') return; btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
  acting++;
  try {
    const r = await fn();
    if (r === CANCEL) return;
    await load();
    const m = typeof okMsg === 'function' ? okMsg(r) : okMsg;
    if (m) toast(m);
  } catch (e) { toast(e.message || 'Có lỗi, vui lòng thử lại', 'danger'); }
  finally {
    acting--;
    if (btn) {
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      const f = document.activeElement;
      if (btn.isConnected && (!f || f === document.body || f.closest('dialog:not([open])'))) btn.focus();
    }
  }
}
const rfOf = (code) => (overview && overview.refunds || []).find(x => x.code === code) || {};
const decide = (code, decision) => act(async () => {
  const r = rfOf(code);
  const note = decision === 'NGOAI_LE'
    ? await uiPrompt({ title: 'Yêu cầu khách bổ sung · ' + code, body: kvHtml([['Đơn', esc(r.order_code || '')], ['Số tiền hoàn', vnd(r.amount)]]), label: 'Thông tin khách cần bổ sung (khách nhận được nội dung này)', multiline: true, required: true, placeholder: 'VD: Ảnh biên lai chưa thấy rõ số tiền và mã giao dịch', confirmLabel: 'Gửi yêu cầu cho khách' })
    : await uiPrompt({ title: 'Ghi chú đối chiếu · ' + code, label: 'Ghi chú (tùy chọn)', multiline: true, placeholder: 'VD: Biên lai khớp log cổng thanh toán', confirmLabel: 'Lưu' });
  if (note === null) return CANCEL;
  await post('decide', { refund_code: code, decision, note });
}, decision === 'NGOAI_LE' ? 'Đã gửi yêu cầu bổ sung cho khách' : 'Đã lưu đối chiếu');
const remind = (code) => act(async () => { await post('remind', { refund_code: code }); }, 'Đã nhắc khách qua email và trang đơn hàng');
const paid = (code) => act(async () => {
  const ref = document.getElementById('ref-' + code).value.trim();
  if (!ref) { document.getElementById('ref-' + code).focus(); throw new Error('Nhập mã giao dịch chuyển hoàn (FT…) trước khi xác nhận đã chi.'); }
  const r = rfOf(code);
  if (!(await uiConfirm({ title: 'Xác nhận đã chuyển khoản hoàn?', confirmLabel: 'Xác nhận đã chi ' + vnd(r.amount),
    body: kvHtml([['Hồ sơ', `<span class="mono">${esc(code)}</span>`], ['Đơn', `<span class="mono">${esc(r.order_code || '')}</span>`], ['Số tiền', vnd(r.amount)],
      ['Chuyển tới', esc([r.bank_name, r.acc_number, r.acc_name].filter(Boolean).join(' · '))], ['Mã giao dịch', `<span class="mono">${esc(ref)}</span>`]]) }))) return CANCEL;
  await post('accounting_paid', { refund_code: code, refund_ref: ref });
}, 'Đã ghi nhận đã chi hồ sơ ' + code);
const confirmDone = (code) => act(async () => {
  if (!(await uiConfirm({ title: 'Khách đã nhận được tiền hoàn?', body: 'Đơn chuyển sang <b>Đã hoàn tiền</b> và khách nhận thông báo kết quả cuối cùng.', confirmLabel: 'Xác nhận hoàn tất' }))) return CANCEL;
  await post('confirm_done', { refund_code: code });
}, 'Đã xác nhận hoàn tất hồ sơ ' + code);
const replyTicket = (code) => act(async () => {
  const message = await uiPrompt({ title: 'Trả lời khách · ' + code, label: 'Nội dung (khách xem ở trang Hỗ trợ và nhận email)', multiline: true, rows: 4, required: true, confirmLabel: 'Gửi trả lời' });
  if (message === null) return CANCEL;
  await post('ticket_reply', { ticket_code: code, message });
}, 'Đã gửi trả lời cho khách');
const resolveTicket = (code) => act(async () => {
  const note = await uiPrompt({ title: 'Đóng phiếu ' + code, label: 'Kết quả xử lý', multiline: true, required: true, minlength: 3, confirmLabel: 'Đóng phiếu' });
  if (note === null) return CANCEL;
  await post('resolve_ticket', { ticket_code: code, note });
}, 'Đã đóng phiếu ' + code);

// ---------------- Chi tiết đơn (một màn hình duy nhất – US-05) ----------------
async function openOrder(code, back) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return;
  const key = 'order:' + code;
  drawerNav(key, back);
  try {
  document.getElementById('sb-code').value = code;
  const d = await api('admin?action=order&code=' + encodeURIComponent(code));
  if (drawerKey !== key) return;
  const v = d.view, c = d.context;
  // Nhân viên Quầy: xem gọn (trạng thái, suất, ghế, đã soát chưa), che SĐT / email, có nút soát bằng mã đơn
  if (!can('refund.view')) {
    const o = c.order || {}, phone = String(o.phone || '');
    document.getElementById('d-title').innerHTML = `Đơn <span class="mono">${esc(code)}</span> ${pill(v.status_label, STATUS_TONE[v.status])}`;
    const canCheck = ['CONFIRMED', 'CONFIRMED_LATE'].includes(v.status) && !v.checked_in_at;
    document.getElementById('d-body').innerHTML = kvHtml([
      ['Nội dung', esc(o.kind === 'FNB' ? 'Phiếu bắp nước' : (o.movie_key || ''))],
      ['Rạp / suất', esc([o.cinema, o.show_time, o.show_date].filter(Boolean).join(' · '))],
      ['Ghế', '<span style="font-size: 16px;">' + esc((o.seats || []).join(', ') || '—') + '</span>'],
      ['Khách', esc(o.customer_name || '') + (phone ? ' · <span class="mono">' + esc(phone.slice(0, 3) + ' ••• ' + phone.slice(-3)) + '</span>' : '')],
      ['Đã soát', v.checked_in_at ? esc(t(v.checked_in_at)) : 'Chưa']
    ]) + (canCheck ? `<button class="btn primary lg block" data-on-click="closeDrawer(); doCheckin('${esc(code)}')"><i class="ph-check" aria-hidden="true"></i> Soát vé bằng mã đơn này</button>`
      : ['CONFIRMED', 'CONFIRMED_LATE'].includes(v.status) ? '' : '<div class="alert warn">Đơn chưa xuất vé – không cho vào.</div>');
    showDrawer();
    return;
  }
  document.getElementById('d-title').innerHTML = `Đơn <span class="mono">${esc(code)}</span> ${pill(v.status_label, STATUS_TONE[v.status])}`;
  const rfs = d.refunds.map(r => `
        <div class="card" style="padding: 12px 14px;">
          <div class="kv">
            <span>Hồ sơ</span><b class="mono">${esc(r.code)} ${pill(RF_LABEL[r.status], RF_TONE[r.status])}</b>
            <span>Số tiền / lý do</span><b>${vnd(r.amount)} · ${esc(r.reason)}</b>
            <span>idempotencyKey</span><span class="mono">${esc(r.idempotency_key)}</span>
            <span>Số lần gửi / lỗi gần nhất</span><span>${r.attempts} · ${esc(r.last_error || '—')}</span>
            <span>Hạn tự hoàn</span><span>${t(r.deadline_at)}</span>
            ${r.acc_number ? `<span>RefundForm</span><span>${esc(r.bank_name)} · <span class="mono">${esc(r.acc_number)}</span> · ${esc(r.acc_name)} (gửi ${t(r.form_submitted_at)})</span>` : ''}
            ${r.refund_ref ? `<span>Mã GD hoàn</span><span class="mono">${esc(r.refund_ref)}</span>` : ''}
            ${r.acc_note ? `<span>Kế toán trả về</span><span class="ret-note" style="margin: 0;">${esc(r.acc_note)} (${r.returned_count} lần)</span>` : ''}
          </div>
          ${(r.review_log || []).length ? `<div class="hint">Nhật ký Nhân viên <i class=ph-arrows-left-right aria-hidden=true></i> Kế toán:</div><ul class="rlog">${r.review_log.map(l => `<li>${t(l.at)} · <b>${esc(l.role)}</b> ${esc(l.actor)}: ${esc(l.action)}${l.note ? ' – ' + esc(l.note) : ''}</li>`).join('')}</ul>` : ''}
          ${r.receipt_url ? `<div class="hint">Ảnh biên lai khách gửi:</div><img loading="lazy" decoding="async" class="receipt" src="${esc(r.receipt_url)}" alt="Biên lai">` : ''}
        </div>`).join('');
  document.getElementById('d-body').innerHTML = `
        <div class="kv">
          <span>Khách hàng</span><b>${esc(c.order.customer_name || '')} · ${esc(c.order.phone || '')} · ${esc(c.order.email || '')}</b>
          <span>Phim / suất</span><span>${esc(c.order.movie_key)} · ${esc(c.order.cinema)} · ${esc(c.order.show_time)} ${esc(c.order.show_date)} · ghế ${esc((c.order.seats || []).join(', '))}</span>
          <span>Giá trị / đã nhận</span><b>${vnd(v.total)} / ${vnd(v.paid_amount)}</b>
          <span>Tạo đơn / hết giữ ghế</span><span>${t(v.created_at)} / ${t(v.hold_expires_at)}</span>
          ${v.scan_until ? `<span>ScanList đến</span><span>${t(v.scan_until)}</span>` : ''}
        </div>
        <h3 style="font-size: 13px; color: #005198;">GIAO DỊCH NGÂN HÀNG (SỔ CÁI)</h3>
        ${d.transactions.length ? `<table><thead><tr><th>Mã GD</th><th>Số tiền</th><th>Thời điểm</th><th>Nội dung</th></tr></thead><tbody>${d.transactions.map(x => `<tr><td class="mono">${esc(x.reference_code)}</td><td>${vnd(x.amount)}</td><td>${t(x.transaction_date)}</td><td>${esc(x.content)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có giao dịch nào khớp mã đơn.</div>'}
        <h3 style="font-size: 13px; color: #005198; margin-top: 16px;">HOÀN TIỀN</h3>
        ${rfs || '<div class="empty">Không có.</div>'}
        <h3 style="font-size: 13px; color: #005198;">LỊCH SỬ TRẠNG THÁI</h3>
        <table><tbody>${(v.history || []).map(h => `<tr><td style="width: 150px;">${t(h.at)}</td><td>${esc(h.from || '—')} → <b>${esc(h.to)}</b></td><td>${esc(h.note)}</td></tr>`).join('')}</tbody></table>
        <h3 style="font-size: 13px; color: #005198; margin-top: 16px;">THÔNG BÁO ĐÃ GỬI</h3>
        <table><tbody>${d.notifications.map(n => `<tr><td style="width: 150px;">${t(n.created_at)}</td><td>${pill(n.channel, 'info')}</td><td>${esc(n.recipient)}</td><td><b>${esc(n.title)}</b><br>${esc(n.message)}</td></tr>`).join('') || '<tr><td class="empty">Chưa có.</td></tr>'}</tbody></table>
        <h3 style="font-size: 13px; color: #005198; margin-top: 16px;">LOG CỔNG THANH TOÁN</h3>
        ${logTable(d.logs)}`;
  showDrawer();
  } catch (e) { if (drawerKey === key) toast('Không mở được đơn ' + code + ': ' + e.message, 'danger'); }
}

// Hàm khai báo bằng const không tự nằm trên window; nút data-on-click trong HTML (js/actions.js) chỉ tìm hàm trên window
Object.assign(window, {
  closeUserMenu, sendSelected, downloadPayout, downloadDays, savePriceRule, saveHoliday, createShowtimes,
  copyWeek, saveMovie, saveVoucher, saveBanner, savePost, sendCampaign, saveCinema, saveRoom, createStaff,
  runJob, deleteRule, saveTicketType, deleteHoliday, deleteBanner, deletePost, toggleShowtime, updateStaff,
  resetStaffPass, reset2fa, eventQuote, eventSet, hideReview, assignTicket, sendTicketReply, addTicketNote,
  closeTicket, sendOne, decide, remind, confirmDone, cancelInvoice, reopenDay, paid
});

// Mở lại trang khi còn phiên: lỗi 401 thì api() đã tự đăng xuất; lỗi khác báo đúng lỗi, không nói "hết phiên"
if (TOKEN) enter().catch(e => { if (e && e.status === 401) return; if (ME) toast(e.message, 'danger'); else { logout(); loginMsg('Không vào được trang quản trị: ' + e.message); } }); else initLogin();
// Tự làm mới 20 giây/lần cho tab đang mở – bỏ qua khi đang gõ, đang mở ngăn kéo / hộp thoại, trang ẩn, hoặc đang ở Quầy (Quầy tự làm mới bảng suất riêng)
setInterval(() => { if (TOKEN && ME && !document.hidden && !userBusy() && tab !== 'quay') load(true).catch(() => {}); }, 20000);
// ---- Hàm nhỏ cho các nút trong admin.html (trước là thuộc tính sự kiện viết thẳng; CSP không cho chạy nữa) ----
function closeTwofa() { document.getElementById('twofa').hidden = true; }
function showLoginPass(on) { document.getElementById('lg-pass').type = on ? 'text' : 'password'; }
function openDlg(id) { document.getElementById(id).showModal(); }
function closeDlg(id) { document.getElementById(id).close(); }
function syncRoomPick(roomId) { document.getElementById('sc-room').disabled = !!roomId; }
function saveQcSound(on) { try { localStorage.setItem('beta_qc_sound', on ? '1' : '0'); } catch (e) { /* bỏ qua */ } }
function togglePaidBatch(on) { document.getElementById('pd-batch').disabled = !on; }
function checkinFromInput() { doCheckin(document.getElementById('ck-input').value); }
function openOrderFromInput() { openOrder(document.getElementById('q-code').value); }
function scrollToCard(id) { document.getElementById(id).scrollIntoView({ behavior: 'smooth' }); }
function openOrderKey(ev, code) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openOrder(code); } }
