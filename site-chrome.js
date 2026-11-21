// site-chrome.js - Phần khung dùng chung của mọi trang khách:
//   - Ô chọn rạp ở đầu trang (select.cinema-select-official không có id riêng) + danh sách rạp ở chân trang
//   - Đợt 8: nút ☰ mở menu trượt trên điện thoại / máy tính bảng, ô tìm phim & rạp (phím tắt "/"),
//     thanh "Cài app" mảnh ở đầu trang thay cho hộp nổi che nội dung
// Chọn rạp -> nhớ lại (localStorage BETA_CINEMA) và mở lịch chiếu của rạp đó.
// Trang schedule/booking tự quản lý ô chọn rạp có id riêng nên không bị đụng tới.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var KEY = 'BETA_CINEMA';
  var CACHE = 'BETA_CINEMAS_CACHE';
  var MCACHE = 'BETA_MOVIES_CACHE';
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
  // Bỏ dấu để tìm "my dinh" ra "Mỹ Đình"
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function cached(key, action, field) {
    try {
      var c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.at < TTL && c.list.length) return Promise.resolve(c.list);
    } catch (e) { /* bỏ qua */ }
    return fetch(apiBase() + 'catalog?action=' + action)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j[field]) || [];
        try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), list: list })); } catch (e) { /* bỏ qua */ }
        return list;
      });
  }
  function loadCinemas() { return cached(CACHE, 'cinemas', 'cinemas'); }
  function loadMovies() { return cached(MCACHE, 'movies', 'movies'); }
  window.BetaChrome = { loadCinemas: loadCinemas, loadMovies: loadMovies, norm: norm, openSearch: function () { openSearch(); } };

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
        return '<li><a href="rap.html?id=' + encodeURIComponent(c.id) + '">' + esc(label(c)) + '</a></li>';
      }).join('');
    });
  }

  // ---------------------------------------------------------------------------
  // Đầu trang: nút tìm kiếm + nút ☰ (chỉ hiện ở màn hình ≤ 1100px)
  // ---------------------------------------------------------------------------
  var burger = null;
  function headerTools() {
    var row = document.querySelector('.header-main-official .header-row');
    if (!row || row.querySelector('.hdr-tools')) return;
    var box = document.createElement('div');
    box.className = 'hdr-tools';
    box.innerHTML = '<button type="button" class="hdr-btn hdr-search" aria-label="Tìm phim, rạp" title="Tìm phim, rạp (phím /)"><i class="ph-magnifying-glass" aria-hidden="true"></i></button>' +
      '<button type="button" class="hdr-btn hdr-burger" aria-label="Mở menu" aria-expanded="false" aria-controls="site-drawer"><i class="ph-list" aria-hidden="true"></i></button>';
    row.appendChild(box);
    box.querySelector('.hdr-search').onclick = function () { openSearch(); };
    burger = box.querySelector('.hdr-burger');
    burger.onclick = openDrawer;
  }

  // ---------------------------------------------------------------------------
  // Menu trượt (điện thoại / máy tính bảng)
  // ---------------------------------------------------------------------------
  var ICON = { 'schedule.html': 'ph-calendar', 'home.html': 'ph-film-strip', 'rap.html': 'ph-map-pin', 'gia-ve.html': 'ph-tag', 'bap-nuoc.html': 'ph-popcorn', 'tin-tuc.html': 'ph-megaphone', 'account.html': 'ph-crown' };
  var drawer = null, backdrop = null;
  function buildDrawer() {
    if (drawer) return drawer;
    var links = [].slice.call(document.querySelectorAll('.header-main-official .main-menu-official a'));
    if (!links.length) return null;
    backdrop = document.createElement('div');
    backdrop.className = 'site-drawer-backdrop';
    backdrop.onclick = closeDrawer;
    drawer = document.createElement('aside');
    drawer.id = 'site-drawer';
    drawer.className = 'site-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Menu');
    var nav = links.map(function (a) {
      var href = a.getAttribute('href');
      var cur = a.classList.contains('active') ? ' aria-current="page"' : '';
      return '<li><a href="' + esc(href) + '"' + cur + '><i class="' + (ICON[href] || 'ph-caret-right') + '" aria-hidden="true"></i>' + esc(a.textContent.trim()) + '</a></li>';
    }).join('');
    var lang = window.BetaI18n && window.BetaI18n.lang === 'en' ? 'en' : 'vi';
    drawer.innerHTML =
      '<div class="sd-head"><a href="home.html" aria-label="Về trang chủ"><img src="images/logo-official.png" alt="Beta Cinemas"></a>' +
      '<button type="button" class="hdr-btn sd-close" aria-label="Đóng menu"><i class="ph-x" aria-hidden="true"></i></button></div>' +
      '<div class="sd-body"><div class="sd-user" id="sd-user"></div>' +
      '<nav aria-label="Điều hướng chính"><ul class="sd-nav">' + nav + '</ul>' +
      '<ul class="sd-nav sd-sub">' +
      '<li><button type="button" data-sd="search"><i class="ph-magnifying-glass" aria-hidden="true"></i>Tìm phim, rạp</button></li>' +
      '<li><a href="thue-rap.html"><i class="ph-armchair" aria-hidden="true"></i>Thuê rạp, vé nhóm & Private Show</a></li>' +
      '<li><a href="refund-track.html"><i class="ph-money-wavy" aria-hidden="true"></i>Tra cứu hoàn tiền</a></li>' +
      '<li><a href="support.html"><i class="ph-chat-circle-dots" aria-hidden="true"></i>Hỗ trợ CSKH</a></li>' +
      '<li><a href="betabot.html"><i class="ph-robot" aria-hidden="true"></i>Hỏi BetaBot 24/7</a></li>' +
      '</ul></nav></div>' +
      '<div class="sd-foot"><a href="tel:1900636807"><i class="ph-phone" aria-hidden="true"></i> 1900 636 807</a>' +
      '<button type="button" data-sd="lang" data-no-i18n aria-label="' + (lang === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English') + '">' + (lang === 'en' ? 'Tiếng Việt' : 'English') + '</button></div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    drawer.querySelector('.sd-close').onclick = closeDrawer;
    drawer.querySelector('[data-sd="search"]').onclick = function () { closeDrawer(); openSearch(); };
    drawer.querySelector('[data-sd="lang"]').onclick = function () {
      if (window.BetaI18n) window.BetaI18n.set(window.BetaI18n.lang === 'en' ? 'vi' : 'en');
    };
    drawer.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      var f = [].slice.call(drawer.querySelectorAll('a[href],button:not([disabled])'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    return drawer;
  }
  function renderUser() {
    var box = document.getElementById('sd-user');
    if (!box) return;
    var A = window.BetaAuth;
    var u = A && A.token && A.token() ? A.cachedUser() : null;
    if (u) {
      box.innerHTML = 'Xin chào, <b>' + esc(u.full_name || u.email || '') + '</b>' +
        '<div class="sd-row"><a href="account.html" class="pri">Tài khoản</a><button type="button" data-sd="logout">Đăng xuất</button></div>';
      box.querySelector('[data-sd="logout"]').onclick = function () { A.logout(); };
    } else {
      box.innerHTML = 'Đăng nhập để tích điểm Beta Club và xem vé đã mua.' +
        '<div class="sd-row"><a href="auth.html#login" class="pri">Đăng nhập</a><a href="auth.html#register">Đăng ký</a></div>';
    }
  }
  function openDrawer() {
    if (!buildDrawer()) return;
    renderUser();
    document.body.classList.add('drawer-open');
    if (burger) burger.setAttribute('aria-expanded', 'true');
    setTimeout(function () { var c = drawer.querySelector('.sd-close'); if (c) c.focus(); }, 30);
  }
  function closeDrawer() {
    document.body.classList.remove('drawer-open');
    if (burger) { burger.setAttribute('aria-expanded', 'false'); burger.focus(); }
  }
  // Xoay ngang / phóng to màn hình lên cỡ máy tính: đóng menu
  window.addEventListener('resize', function () { if (window.innerWidth > 1100 && document.body.classList.contains('drawer-open')) closeDrawer(); });

  // ---------------------------------------------------------------------------
  // Ô tìm phim & rạp (gõ không dấu cũng tìm được)
  // ---------------------------------------------------------------------------
  var ss = null, ssInput = null, ssList = null, ssData = null, ssPrevFocus = null;
  function buildSearch() {
    if (ss) return;
    ss = document.createElement('div');
    ss.className = 'site-search';
    ss.setAttribute('role', 'dialog');
    ss.setAttribute('aria-modal', 'true');
    ss.setAttribute('aria-label', 'Tìm phim, rạp');
    ss.innerHTML = '<div class="ss-box"><div class="ss-in"><i class="ph-magnifying-glass" aria-hidden="true"></i>' +
      '<input type="search" id="ss-q" autocomplete="off" placeholder="Tìm phim, rạp… (vd: suzume, my dinh)" aria-label="Tìm phim, rạp" aria-controls="ss-list">' +
      '<button type="button" data-ss="close">Đóng</button></div>' +
      '<div class="ss-list" id="ss-list" aria-live="polite"><p class="ss-empty">Đang tải…</p></div></div>';
    document.body.appendChild(ss);
    ssInput = ss.querySelector('#ss-q');
    ssList = ss.querySelector('#ss-list');
    ss.addEventListener('click', function (e) { if (e.target === ss || (e.target.closest && e.target.closest('[data-ss="close"]'))) closeSearch(); });
    ssInput.addEventListener('input', function () { renderSearch(); });
    ss.addEventListener('keydown', function (e) {
      var items = [].slice.call(ssList.querySelectorAll('.ss-item'));
      var i = items.findIndex(function (x) { return x.classList.contains('on'); });
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        if (i > -1) items[i].classList.remove('on');
        i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[i].classList.add('on');
        items[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && e.target === ssInput) {
        var go = items[i > -1 ? i : 0];
        if (go) { e.preventDefault(); location.href = go.getAttribute('href'); }
      }
    });
  }
  function movieItem(m) {
    var genre = m.genre || String(m.meta || '').split('·')[0];
    return '<a class="ss-item" href="/phim/' + encodeURIComponent(m.key) + '"><img src="' + esc(m.poster) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
      '<span><b>' + esc(m.title) + '</b><small>' + esc([genre, m.duration_min ? m.duration_min + ' phút' : '', m.age].filter(Boolean).join(' · ')) + '</small></span>' +
      (m.status === 'SOON' ? '<span class="ss-tag">Sắp chiếu</span>' : '') + '</a>';
  }
  function cinemaItem(c) {
    return '<a class="ss-item" href="/rap.html?id=' + encodeURIComponent(c.id) + '"><span class="ss-ic"><i class="ph-map-pin" aria-hidden="true"></i></span>' +
      '<span><b>' + esc(c.name) + '</b><small>' + esc([c.address, c.city].filter(Boolean).join(', ')) + '</small></span></a>';
  }
  function renderSearch() {
    if (!ssData) return;
    var q = norm(ssInput.value);
    var words = q ? q.split(' ') : [];
    var hit = function (text) { var t = norm(text); return words.every(function (w) { return t.indexOf(w) > -1; }); };
    var movies = q ? ssData.movies.filter(function (m) { return hit([m.title, m.shortTitle, m.genre, m.meta].join(' ')); }) : ssData.movies.filter(function (m) { return m.status !== 'SOON'; }).slice(0, 6);
    var cinemas = q ? ssData.cinemas.filter(function (c) { return hit([c.name, c.city, c.address].join(' ')); }) : [];
    var html = '';
    if (movies.length) html += '<div class="ss-group">' + (q ? 'Phim' : 'Phim đang chiếu') + '</div>' + movies.slice(0, 8).map(movieItem).join('');
    if (cinemas.length) html += '<div class="ss-group">Rạp</div>' + cinemas.slice(0, 6).map(cinemaItem).join('');
    if (!html) html = '<p class="ss-empty">Không tìm thấy phim hay rạp nào khớp “' + esc(ssInput.value.trim()) + '”. Thử gõ ít chữ hơn.</p>';
    ssList.innerHTML = html;
  }
  function openSearch() {
    buildSearch();
    ssPrevFocus = document.activeElement;
    ss.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { ssInput.focus(); ssInput.select(); }, 20);
    if (ssData) { renderSearch(); return; }
    Promise.all([loadMovies(), loadCinemas()]).then(function (r) {
      ssData = { movies: r[0] || [], cinemas: r[1] || [] };
      renderSearch();
    }).catch(function () { ssList.innerHTML = '<p class="ss-empty">Không tải được danh sách phim. Kiểm tra kết nối mạng rồi thử lại.</p>'; });
  }
  function closeSearch() {
    if (!ss) return;
    ss.classList.remove('open');
    document.body.style.overflow = '';
    if (ssPrevFocus && ssPrevFocus.focus) ssPrevFocus.focus();
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (!document.querySelector('.header-main-official')) return;
    e.preventDefault();
    openSearch();
  });

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

    // Đợt 8: lời mời cài app là một dải mảnh trên cùng (không che nội dung), chỉ ở trang xem phim / lịch chiếu,
    // không hiện giữa luồng đặt vé – thanh toán. Ẩn 30 ngày nếu khách bấm đóng.
    var BROWSE = /(^\/$|\/(home|schedule|movie-detail|rap|tin-tuc|gia-ve)\.html$|^\/phim\/)/;
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      if (!BROWSE.test(location.pathname)) return;
      var until = Number(store(true, 'BETA_PWA_DISMISS') || 0);
      if (Date.now() < until || document.getElementById('pwa-install')) return;
      var bar = document.createElement('div');
      bar.id = 'pwa-install';
      bar.className = 'pwa-bar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Cài ứng dụng Beta Cinemas');
      bar.innerHTML = '<img src="/images/pwa-192.png" alt="" width="30" height="30">' +
        '<span>Cài app Beta: xem vé QR cả khi mất mạng</span>' +
        '<button type="button" class="ok" data-a="ok">Cài</button>' +
        '<button type="button" class="no" data-a="no" aria-label="Đóng">×</button>';
      bar.onclick = function (e) {
        var a = e.target && e.target.getAttribute('data-a');
        if (a === 'ok') { ev.prompt(); bar.remove(); }
        if (a === 'no') { store(false, 'BETA_PWA_DISMISS', String(Date.now() + 30 * 864e5)); bar.remove(); }
      };
      document.body.insertBefore(bar, document.body.firstChild);
    });
  }
  if (!/\/admin\.html$/.test(location.pathname)) pwa();

  // ---------------------------------------------------------------------------
  // Đợt 10: trang thiếu css/icons.css (nút ☰ / tìm kiếm thành ô trống) -> tự thêm
  // ---------------------------------------------------------------------------
  function ensureIcons() {
    if (document.querySelector('link[href$="icons.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/icons.css'; document.head.appendChild(l);
  }

  // Đợt 10: web thật chưa nối database (máy chủ khóa đặt vé) -> báo cho khách ngay đầu trang
  function maintenance() {
    var show = function (missing) {
      if (!missing || document.getElementById('maint-bar')) return;
      var bar = document.createElement('div');
      bar.id = 'maint-bar';
      bar.setAttribute('role', 'alert');
      bar.style.cssText = 'background:#b91c1c;color:#fff;padding:10px 14px;text-align:center;font:700 14px/1.45 "Be Vietnam Pro",system-ui,sans-serif';
      bar.textContent = 'Đặt vé online đang tạm ngưng để bảo trì. Bạn vẫn xem được lịch chiếu; vui lòng mua vé tại quầy hoặc quay lại sau.';
      document.body.insertBefore(bar, document.body.firstChild);
    };
    try {
      var c = JSON.parse(sessionStorage.getItem('BETA_HEALTH') || 'null');
      if (c && Date.now() - c.at < 5 * 60 * 1000) return show(c.missing);
    } catch (e) { /* bỏ qua */ }
    fetch(apiBase() + 'health', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var missing = !!(j && j.db === 'missing');
      try { sessionStorage.setItem('BETA_HEALTH', JSON.stringify({ at: Date.now(), missing: missing })); } catch (e) { /* bỏ qua */ }
      show(missing);
    }).catch(function () { /* mất mạng: không báo */ });
  }

  // Đợt 10: chân trang chỉ ghi cổng thanh toán đang thật sự bật (VietQR luôn có; VNPay / MoMo / ZaloPay khi đã cấu hình)
  function partners() {
    var h = [].slice.call(document.querySelectorAll('.footer-official-title')).find(function (x) { return /ĐỐI TÁC THANH TOÁN/i.test(x.textContent); });
    var box = h && h.nextElementSibling;
    if (!box) return;
    var STY = { VNPAY: ['VNPAY-QR', 'background:#fff;color:#005198'], MOMO: ['MoMo', 'background:#a50064;color:#fff'], ZALOPAY: ['ZaloPay', 'background:#0068ff;color:#fff'] };
    var got;
    try { var c = JSON.parse(sessionStorage.getItem('BETA_PAY_METHODS') || 'null'); if (c && Date.now() - c.at < TTL) got = Promise.resolve(c.list); } catch (e) { /* bỏ qua */ }
    if (!got) got = fetch(apiBase() + 'pay?action=methods').then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.methods) || [];
      try { sessionStorage.setItem('BETA_PAY_METHODS', JSON.stringify({ at: Date.now(), list: list })); } catch (e) { /* bỏ qua */ }
      return list;
    });
    got.then(function (list) {
      list.forEach(function (m) {
        var s = STY[m.id];
        if (!s || box.querySelector('[data-pm="' + m.id + '"]')) return;
        var b = document.createElement('span');
        b.setAttribute('data-pm', m.id);
        b.style.cssText = s[1] + ';padding:4px 8px;border-radius:4px;font-size:12px;font-weight:800';
        b.textContent = s[0];
        box.appendChild(b);
      });
    }).catch(function () { /* giữ VietQR */ });
  }

  function run() {
    ensureIcons();
    headerTools();
    if (!/\/admin(\.html)?$/.test(location.pathname)) { maintenance(); partners(); }
    loadCinemas().then(apply).catch(function () { /* giữ nội dung tĩnh khi mất mạng */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  // Thanh chuyển giao diện (chỉ có ở localhost) chiếm góc dưới phải -> đẩy nút BetaBot lên
  window.addEventListener('load', function () { if (document.getElementById('quick-dock-widget')) document.body.classList.add('has-dock'); });
})();
