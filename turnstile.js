// turnstile.js - Ô "Tôi không phải robot" (Cloudflare Turnstile) cho các form công khai:
//   Gửi yêu cầu hỗ trợ (support), Thuê rạp (thue-rap), Đăng ký và Quên mật khẩu (auth).
// Chỉ hiện khi máy chủ đã bật Turnstile (đặt TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY, xem lib/turnstile.js);
// chưa bật thì không làm gì. Mã xác minh được gắn vào header X-Turnstile-Token của đúng yêu cầu POST,
// nên code gửi form của từng trang giữ nguyên. Không dùng script inline / thuộc tính on*= (hợp CSP chặt).
(function () {
  if (typeof window === 'undefined' || window.BetaTurnstile) return;
  // action: tên form (máy chủ kiểm tra khớp) · api: yêu cầu POST cần mã · button: ô xác minh đặt ngay trên nút này
  var SPOTS = [
    { action: 'support', api: /\/api\/support(?:\?|$)/, button: 'sp-submit' },
    { action: 'events', api: /\/api\/events(?:\?|$)/, button: 'ev-submit' },
    { action: 'register', api: /\/api\/auth\?(?:[^#]*&)?action=register(?:&|$)/, button: 'btn-register' },
    { action: 'forgot', api: /\/api\/auth\?(?:[^#]*&)?action=forgot(?:&|$)/, button: 'btn-send-code' }
  ];
  var spots = SPOTS.filter(function (s) { return document.getElementById(s.button); });
  window.BetaTurnstile = { spots: spots, enabled: false };
  if (!spots.length) return;

  function apiBase() {
    if (window.Pay && typeof window.Pay.getApiBase === 'function') return window.Pay.getApiBase();
    return (/^55\d\d$/.test(location.port) || location.protocol === 'file:') ? 'http://localhost:5000/api/' : '/api/';
  }
  function lang() { try { return localStorage.getItem('BETA_LANG') === 'en' ? 'en' : 'vi'; } catch (e) { return 'vi'; } }

  // Gắn mã vào yêu cầu POST của form tương ứng; gửi xong thì làm mới ô (mỗi mã chỉ dùng được một lần)
  function hookFetch() {
    var orig = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = String((init && init.method) || (input && typeof input !== 'string' && input.method) || 'GET').toUpperCase();
        var spot = method === 'POST' ? spots.filter(function (s) { return s.api.test(url); })[0] : null;
        if (spot && spot.token) {
          var h = new Headers((init && init.headers) || (typeof input !== 'string' && input && input.headers) || undefined);
          h.set('X-Turnstile-Token', spot.token);
          spot.token = null;
          var p = orig.call(this, input, Object.assign({}, init, { headers: h }));
          var again = function () { try { if (window.turnstile && spot.widget != null) window.turnstile.reset(spot.widget); } catch (e) { /* bỏ qua */ } };
          p.then(again, again);
          return p;
        }
      } catch (e) { /* không chặn việc gửi form */ }
      return orig.apply(this, arguments);
    };
  }

  function render(key) {
    spots.forEach(function (s) {
      var btn = document.getElementById(s.button);
      if (!btn || s.box) return;
      s.box = document.createElement('div');
      s.box.className = 'ts-box';
      s.box.style.cssText = 'min-height: 65px; margin: 2px 0 6px;';
      btn.parentNode.insertBefore(s.box, btn);
      s.widget = window.turnstile.render(s.box, {
        sitekey: key, action: s.action, size: 'flexible', theme: 'light', language: lang(),
        callback: function (t) { s.token = t; },
        'expired-callback': function () { s.token = null; },
        'error-callback': function () { s.token = null; }
      });
    });
  }

  fetch(apiBase() + 'catalog?action=turnstile').then(function (r) { return r.json(); }).then(function (j) {
    var key = j && j.site_key;
    if (!key) return; // máy chủ chưa bật Turnstile
    window.BetaTurnstile.enabled = true;
    hookFetch();
    window.__betaTurnstileOnload = function () { render(key); };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__betaTurnstileOnload';
    s.async = true;
    document.head.appendChild(s);
  }).catch(function () { /* không lấy được cấu hình: giữ form như cũ */ });
})();
