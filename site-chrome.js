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

  function run() { loadCinemas().then(apply).catch(function () { /* giữ nội dung tĩnh khi mất mạng */ }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
