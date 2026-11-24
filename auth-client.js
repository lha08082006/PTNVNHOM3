// auth-client.js - Phiên đăng nhập thành viên Beta Club ở trình duyệt
// - Lưu token trong localStorage (khóa BETA_AUTH_TOKEN); pay-client.js tự gửi kèm token khi gọi /api.
// - Tự cập nhật vùng .top-auth-links (Đăng nhập/Đăng ký <-> Xin chào, tên | Đăng xuất)
//   và điền mọi phần tử [data-user="full_name|email|phone"] bằng hồ sơ thật.
(function () {
  const TOKEN_KEY = 'BETA_AUTH_TOKEN';
  const USER_KEY = 'BETA_AUTH_USER';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function apiBase() {
    // Live Server (port 55xx) hoặc file:// -> server Node port 5000; còn lại API cùng nguồn
    return (/^55\d\d$/.test(location.port) || location.protocol === 'file:') ? 'http://localhost:5000/api/' : '/api/';
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Gốc của site = thư mục chứa auth-client.js: "/" trên Vercel và server Node; Live Server / file:// có thể là thư mục con
  const SITE_ROOT = (function () {
    try { return new URL('.', document.currentScript.src).pathname; } catch (e) { return '/'; }
  })();
  // Trang đang xem tính từ gốc site, giữ cả thư mục con và tham số: "checkout?showtime=…", "phim/suzume"
  // (Vercel bật cleanUrls nên đường dẫn thường không có ".html")
  function currentPage() {
    const p = location.pathname;
    const rel = (p.indexOf(SITE_ROOT) === 0 ? p.slice(SITE_ROOT.length) : p).replace(/^\/+|\/+$/g, '');
    return rel ? rel + location.search : '';
  }

  // Luật kiểm tra dữ liệu khách nhập – GIỐNG HỆT máy chủ (lib/auth.js: checkName, checkMobile, checkBirthday, checkPassword)
  // để báo lỗi ngay trên form (auth.html, account.html); máy chủ vẫn kiểm tra lại. Mỗi hàm trả '' nếu hợp lệ, ngược lại trả câu báo lỗi.
  // Biểu thức \p{L} tạo bằng new RegExp: trình duyệt quá cũ không hiểu thì bỏ qua bước đó (không làm hỏng cả file), máy chủ vẫn chặn.
  const uRe = (src) => { try { return new RegExp(src, 'u'); } catch (e) { return null; } };
  const NAME_RE = uRe("^[\\p{L}\\p{M}][\\p{L}\\p{M}\\s'.-]{1,59}$");
  const LETTER_RE = uRe('\\p{L}');
  const WEAK_PASSWORDS = ['12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', 'password', 'password1', 'password123',
    'matkhau', 'matkhau1', 'matkhau123', 'abc12345', 'qwerty123', '12341234', 'iloveyou'];
  const MSG = {
    name: 'Họ tên chỉ gồm chữ cái (có dấu) và khoảng trắng, từ 2 đến 60 ký tự',
    phone: 'Số điện thoại di động không hợp lệ (VD: 0987654321)',
    birthday: 'Ngày sinh không hợp lệ',
    password: 'Mật khẩu cần ít nhất 8 ký tự, có cả chữ và số, không dùng mật khẩu quá phổ biến',
    samePassword: 'Mật khẩu mới phải khác mật khẩu hiện tại'
  };
  const check = {
    MIN_BIRTHDAY: '1920-01-01',
    today: () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), // hôm nay theo giờ Việt Nam, như máy chủ
    normName: (s) => String(s || '').trim().replace(/\s+/g, ' '),
    normPhone: (s) => String(s || '').replace(/[\s.-]/g, ''),
    name: (s) => (!NAME_RE || NAME_RE.test(check.normName(s)) ? '' : MSG.name),
    phone: (s) => (/^0(3|5|7|8|9)\d{8}$/.test(check.normPhone(s)) ? '' : MSG.phone),
    // Ngày sinh không bắt buộc. el = ô <input type="date">: gõ dở / sai ngày thì value rỗng nhưng vẫn phải báo lỗi
    birthday(s, el) {
      if (el && el.validity && el.validity.badInput) return MSG.birthday;
      if (s == null || s === '') return '';
      s = String(s);
      const real = /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
      return real && s >= check.MIN_BIRTHDAY && s <= check.today() ? '' : MSG.birthday;
    },
    password(p) {
      p = String(p || '');
      const ok = p.length >= 8 && (!LETTER_RE || LETTER_RE.test(p)) && /\d/.test(p) && WEAK_PASSWORDS.indexOf(p.toLowerCase()) < 0;
      return ok ? '' : MSG.password;
    },
    // Đổi mật khẩu: mật khẩu mới phải khác mật khẩu hiện tại và đúng luật mật khẩu
    newPassword: (cur, nw) => (String(nw || '') === String(cur || '') ? MSG.samePassword : check.password(nw))
  };

  const BetaAuth = {
    check,
    token: () => store.get(TOKEN_KEY),
    cachedUser() { try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch (e) { return null; } },
    isLoggedIn: () => !!store.get(TOKEN_KEY),

    async call(action, { method = 'GET', body } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      const t = BetaAuth.token();
      if (t) headers.Authorization = 'Bearer ' + t;
      const r = await fetch(apiBase() + 'auth?action=' + action, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && t && action !== 'login') BetaAuth._clear();
      if (!r.ok) { const e = new Error(j.error || 'Lỗi hệ thống (' + r.status + ')'); e.status = r.status; throw e; }
      return j;
    },

    _save(j) {
      if (j.token) store.set(TOKEN_KEY, j.token);
      if (j.user) store.set(USER_KEY, JSON.stringify(j.user));
      BetaAuth.render();
      return j.user;
    },
    _clear() { store.del(TOKEN_KEY); store.del(USER_KEY); },

    async login(login, password) { return BetaAuth._save(await BetaAuth.call('login', { method: 'POST', body: { login, password } })); },
    async register(data) { return BetaAuth._save(await BetaAuth.call('register', { method: 'POST', body: data })); },
    async updateProfile(data) { return BetaAuth._save(await BetaAuth.call('profile', { method: 'POST', body: data })); },
    async changePassword(current_password, new_password) {
      return BetaAuth._save(await BetaAuth.call('password', { method: 'POST', body: { current_password, new_password } }));
    },

    // Hỏi lại máy chủ để chắc token còn hiệu lực; trả null nếu chưa đăng nhập
    async me() {
      if (!BetaAuth.token()) return null;
      try { return BetaAuth._save(await BetaAuth.call('me')); } catch (e) { if (e.status === 401) { BetaAuth.render(); return null; } return BetaAuth.cachedUser(); }
    },

    logout(redirect = 'home.html') {
      BetaAuth._clear();
      if (redirect) location.href = redirect;
      else BetaAuth.render();
    },

    // Trang cần đăng nhập: chuyển sang auth.html, đăng nhập xong quay lại đúng trang này (kể cả /phim/<mã-phim>)
    loginUrl(next = currentPage()) {
      return 'auth.html?next=' + encodeURIComponent(next || 'account.html') + '#login';
    },
    async requireLogin() {
      const u = await BetaAuth.me();
      if (!u) { location.replace(BetaAuth.loginUrl()); return new Promise(() => {}); }
      return u;
    },

    render() {
      const u = BetaAuth.token() ? BetaAuth.cachedUser() : null;
      document.querySelectorAll('.top-auth-links').forEach(el => {
        el.innerHTML = u
          ? `<span style="color: #005198;">Xin chào, <a href="account.html" style="color: inherit;"><strong>${esc(u.full_name)}</strong></a></span>
             <span>|</span><a href="javascript:void(0)" data-auth-logout>Đăng xuất</a>
             <span>|</span><a href="betabot.html">Hỗ trợ CSKH</a>`
          : `<a href="auth.html#login">Đăng nhập</a><span>|</span><a href="auth.html#register">Đăng ký</a>
             <span>|</span><a href="betabot.html">Hỗ trợ CSKH</a>`;
      });
      document.querySelectorAll('[data-auth-logout]').forEach(a => { a.onclick = (e) => { e.preventDefault(); BetaAuth.logout(); }; });
      document.querySelectorAll('[data-user]').forEach(el => {
        const v = u ? u[el.getAttribute('data-user')] : '';
        if (el.tagName === 'INPUT') { if (v != null) el.value = v || ''; }
        else el.textContent = v || el.getAttribute('data-user-empty') || '';
      });
    }
  };

  window.BetaAuth = BetaAuth;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', BetaAuth.render);
  else BetaAuth.render();
})();
