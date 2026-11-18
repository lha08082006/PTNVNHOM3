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

  const BetaAuth = {
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

    // Trang cần đăng nhập: chuyển sang auth.html, đăng nhập xong quay lại đúng trang này
    loginUrl(next = location.pathname.split('/').pop() + location.search) {
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
