// site-chrome.js - Đồng bộ phần khung dùng chung của mọi trang với database:
//   - Ô chọn rạp ở đầu trang (select.cinema-select-official không có id riêng)
//   - Danh sách "CỤM RẠP BETA CINEMAS" ở chân trang
// Chọn rạp -> nhớ lại (localStorage BETA_CINEMA) và mở lịch chiếu của rạp đó.
// Trang schedule/booking tự quản lý ô chọn rạp có id riêng nên không bị đụng tới.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var KEY = 'BETA_CINEMA';
  var CACHE = 'BETA_CINEMAS_CACHE';
  var TTL = 10 * 60 * 1000;

  function store(get, k, v) {
    try { return get ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function apiBase() {
    if (window.Pay && typeof window.Pay.getApiBase === 'function') return window.Pay.getApiBase();
    return (/^55\d\d$/.test(location.port) || location.protocol === 'file:') ? 'http://localhost:5000/api/' : '/api/';
  }
  function label(c) { return c.name + (c.city ? ' (' + c.city + ')' : ''); }

  function loadCinemas() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
      if (cached && Date.now() - cached.at < TTL && cached.list.length) return Promise.resolve(cached.list);
    } catch (e) { /* bỏ qua */ }
    return fetch(apiBase() + 'catalog?action=cinemas')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.cinemas) || [];
        try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), list: list })); } catch (e) { /* bỏ qua */ }
        return list;
      });
  }

  // Gọi từ trang khác (vd schedule.html) khi khách đổi rạp
  window.BetaRememberCinema = function (id) { if (id) store(false, KEY, id); };

  function apply(list) {
    if (!list.length) return;
    var saved = store(true, KEY);
    var current = list.some(function (c) { return c.id === saved; }) ? saved : list[0].id;

    document.querySelectorAll('select.cinema-select-official:not([id])').forEach(function (sel) {
      sel.innerHTML = list.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === current ? ' selected' : '') + '>' + esc(label(c)) + '</option>';
      }).join('');
      sel.removeAttribute('onchange');
      sel.onchange = function () {
        store(false, KEY, sel.value);
        location.href = 'schedule.html?cinema=' + encodeURIComponent(sel.value);
      };
    });

    document.querySelectorAll('.footer-official-title').forEach(function (h) {
      if (!/CỤM RẠP/i.test(h.textContent)) return;
      var ul = h.nextElementSibling;
      if (!ul || ul.tagName !== 'UL') return;
      ul.innerHTML = list.map(function (c) {
        return '<li><a href="schedule.html?cinema=' + encodeURIComponent(c.id) + '">' + esc(label(c)) + '</a></li>';
      }).join('');
    });
  }

  // ---- PWA (Đợt 2): cài web lên màn hình điện thoại như app, mở vé QR khi mất mạng ----
  function pwa() {
    var head = document.head;
    function link(rel, href) {
      if (document.querySelector('link[rel="' + rel + '"]')) return;
      var l = document.createElement('link'); l.rel = rel; l.href = href; head.appendChild(l);
    }
    link('manifest', '/manifest.webmanifest');
    link('apple-touch-icon', '/images/apple-touch-icon.png');
    if (!document.querySelector('meta[name="theme-color"]')) {
      var m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#005198'; head.appendChild(m);
    }
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('/sw.js').catch(function () { /* trình duyệt chặn: web vẫn chạy bình thường */ });

    // Nút "Cài ứng dụng" khi trình duyệt cho phép (Chrome/Edge Android & máy tính). Ẩn 30 ngày nếu khách bấm đóng.
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      var until = Number(store(true, 'BETA_PWA_DISMISS') || 0);
      if (Date.now() < until || document.getElementById('pwa-install')) return;
      var box = document.createElement('div');
      box.id = 'pwa-install';
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', 'Cài ứng dụng Beta Cinemas');
      box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9990;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 96px);background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:8px 10px;box-shadow:0 8px 24px rgba(0,0,0,.15);font:600 13px/1.3 "Be Vietnam Pro",system-ui,sans-serif;color:#0f172a';
      box.innerHTML = '<img src="/images/pwa-192.png" alt="" width="32" height="32" style="border-radius:8px">' +
        '<span>Cài app Beta: xem vé QR cả khi mất mạng</span>' +
        '<button type="button" data-a="ok" style="border:0;background:#005198;color:#fff;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer;min-height:36px">Cài</button>' +
        '<button type="button" data-a="no" aria-label="Đóng" style="border:0;background:none;font-size:18px;cursor:pointer;color:#64748b;min-width:32px;min-height:36px">×</button>';
      box.onclick = function (e) {
        var a = e.target && e.target.getAttribute('data-a');
        if (a === 'ok') { ev.prompt(); box.remove(); }
        if (a === 'no') { store(false, 'BETA_PWA_DISMISS', String(Date.now() + 30 * 864e5)); box.remove(); }
      };
      document.body.appendChild(box);
    });
  }
  if (!/\/admin\.html$/.test(location.pathname)) pwa();

  function run() { loadCinemas().then(apply).catch(function () { /* giữ nội dung tĩnh khi mất mạng */ }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
