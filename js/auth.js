// js/auth.js - mã của auth.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
function switchToView(view) {
  const forgot = document.getElementById('view-forgot');
  if (view === 'forgot') {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-register').style.display = 'none';
    forgot.style.display = 'flex';
    document.getElementById('page-title').innerText = 'Quên mật khẩu - Beta Cinemas';
    if (location.hash !== '#forgot') location.hash = 'forgot';
    return;
  }
  forgot.style.display = 'none';
  const loginSection = document.getElementById('view-login');
  const registerSection = document.getElementById('view-register');
  const title = document.getElementById('page-title');

  if (view === 'register') {
    loginSection.style.display = 'none';
    registerSection.style.display = 'flex';
    title.innerText = 'Đăng ký tài khoản - Beta Cinemas';
    window.location.hash = 'register';
  } else {
    loginSection.style.display = 'flex';
    registerSection.style.display = 'none';
    title.innerText = 'Đăng nhập - Beta Cinemas';
    window.location.hash = 'login';
  }
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.innerText = 'Ẩn';
  } else {
    input.type = 'password';
    if (btn) btn.innerText = 'Hiện';
  }
}

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || 'account.html';
  // Chỉ quay về trang nội bộ của site (tối đa 2 cấp, ".html" tùy chọn vì Vercel bỏ đuôi): "checkout?…", "checkout.html?…",
  // "phim/suzume". Không có ":" và không bắt đầu bằng "/" hay "\\" nên "https://…", "//…", "/\\…" đều bị chặn.
  return /^[a-z0-9-]+(\/[a-z0-9-]+)?(\.html)?([?#][^\\]*)?$/i.test(n) && !/[:\\]/.test(n.split(/[?#]/)[0]) ? n : 'account.html';
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function handleAuthAction(type) {
  const errId = type === 'login' ? 'login-error' : 'register-error';
  const btn = document.getElementById(type === 'login' ? 'btn-login' : 'btn-register');
  const val = (id) => document.getElementById(id).value.trim();
  showError(errId, '');
  try {
    if (type === 'login') {
      if (!val('input-login-id') || !document.getElementById('input-login-password').value) {
        return showError(errId, 'Vui lòng nhập email/số điện thoại và mật khẩu.');
      }
      btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
      await BetaAuth.login(val('input-login-id'), document.getElementById('input-login-password').value);
    } else {
      const pw = document.getElementById('reg-password').value;
      const phone = val('reg-phone').replace(/[\s.-]/g, '');
      const bday = val('reg-birthday');
      // Cùng luật với máy chủ (BetaAuth.check trong auth-client.js ↔ lib/auth.js)
      const ck = BetaAuth.check; // bản auth-client.js cũ trong bộ nhớ đệm chưa có .check -> để máy chủ kiểm tra
      const bad = !ck ? '' : ck.name(val('reg-name')) || ck.phone(phone) ||
        (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('reg-email')) ? 'Email chưa đúng định dạng (vd: ten@gmail.com).' : '') ||
        ck.birthday(bday, document.getElementById('reg-birthday')) || ck.password(pw);
      if (bad) return showError(errId, bad);
      if (pw !== document.getElementById('reg-password2').value) return showError(errId, 'Mật khẩu xác nhận không khớp.');
      if (!document.getElementById('reg-terms').checked) return showError(errId, 'Vui lòng đồng ý điều khoản sử dụng và chính sách bảo mật.');
      btn.disabled = true; btn.textContent = 'Đang tạo tài khoản...';
      await BetaAuth.register({
        full_name: val('reg-name'), phone, email: val('reg-email'),
        birthday: val('reg-birthday'), password: pw,
        accept_terms: true, marketing_opt_in: document.getElementById('reg-marketing').checked
      });
    }
    location.href = nextUrl();
  } catch (e) {
    showError(errId, e.message);
    btn.disabled = false;
    btn.textContent = type === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target && (e.target.tagName === 'A' || e.target.tagName === 'BUTTON')) return; // để nút/link tự xử lý
  if (document.getElementById('view-forgot').style.display !== 'none') {
    e.preventDefault();
    const step2 = document.getElementById('fg-step2').style.display !== 'none';
    const b = document.getElementById(step2 ? 'btn-reset' : 'btn-send-code');
    if (!b.disabled) (step2 ? resetPassword : sendResetCode)();
    return;
  }
  const login = document.getElementById('view-login').style.display !== 'none';
  const b = document.getElementById(login ? 'btn-login' : 'btn-register');
  if (b.disabled) return;
  e.preventDefault();
  handleAuthAction(login ? 'login' : 'register');
});
window.addEventListener('hashchange', () => switchToView(location.hash.slice(1) || 'login'));

function forgotMsg(text, ok) {
  const el = document.getElementById('forgot-msg');
  el.textContent = text; el.style.color = ok ? '#15803d' : '#dc2626'; el.style.display = text ? 'block' : 'none';
}
async function sendResetCode() {
  const btn = document.getElementById('btn-send-code');
  btn.disabled = true;
  try {
    const r = await BetaAuth.call('forgot', { method: 'POST', body: { email: document.getElementById('fg-email').value.trim() } });
    forgotMsg(r.message + (r.dev_code ? ' (Chạy thử: mã là ' + r.dev_code + ')' : ''), true);
    document.getElementById('fg-step2').style.display = 'flex';
    document.getElementById('fg-code').focus();
    let left = 60;
    btn.textContent = 'Gửi lại mã (60s)';
    const t = setInterval(() => {
      left -= 1;
      btn.textContent = left > 0 ? 'Gửi lại mã (' + left + 's)' : 'Gửi lại mã';
      if (left <= 0) { clearInterval(t); btn.disabled = false; }
    }, 1000);
  } catch (e) { forgotMsg(e.message, false); btn.disabled = false; }
}
async function resetPassword() {
  const btn = document.getElementById('btn-reset');
  if (!/^\d{6}$/.test(document.getElementById('fg-code').value.trim())) return forgotMsg('Mã gồm đúng 6 chữ số trong email.', false);
  if (document.getElementById('fg-pass').value.length < 8) return forgotMsg('Mật khẩu mới phải có ít nhất 8 ký tự.', false);
  btn.disabled = true;
  try {
    BetaAuth._save(await BetaAuth.call('reset', { method: 'POST', body: {
      email: document.getElementById('fg-email').value.trim(), code: document.getElementById('fg-code').value.trim(),
      new_password: document.getElementById('fg-pass').value } }));
    location.href = nextUrl();
  } catch (e) { forgotMsg(e.message, false); btn.disabled = false; }
}

// Tự động kiểm tra URL Hash khi tải trang (#register hoặc #login)
window.addEventListener('DOMContentLoaded', () => {
  const bd = document.getElementById('reg-birthday');
  if (bd && window.BetaAuth && BetaAuth.check) { bd.min = BetaAuth.check.MIN_BIRTHDAY; bd.max = BetaAuth.check.today(); }
  if (window.BetaAuth && BetaAuth.isLoggedIn()) {
    BetaAuth.me().then(u => { if (u) location.replace(nextUrl()); });
  }
  if (window.location.hash === '#forgot') {
    switchToView('forgot');
  } else if (window.location.hash === '#register') {
    switchToView('register');
  } else {
    switchToView('login');
  }
});
