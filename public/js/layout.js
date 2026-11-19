/**
 * js/layout.js - Bố cục dùng chung cho mọi trang Beta Cinemas
 *
 *   <head>  <script src="js/layout.js"></script>
 *   <body>  <script>Layout.header()</script>          // top bar + header
 *           ...nội dung trang...
 *           <script>Layout.footer()</script>          // footer
 *
 * Quick-dock (nút ⚡ góc màn hình) được tự động chèn vào cuối trang.
 * HTML được chèn ĐỒNG BỘ ngay tại vị trí thẻ <script> gọi hàm, nên các script
 * phía sau trong trang vẫn truy cập được các phần tử (#cinema-select, ...).
 */
(function () {
  const CINEMAS = [
    ['Beta Thanh Xuân', 'Beta Thanh Xuân (Hà Nội)'],
    ['Beta Trần Quang Khải', 'Beta Trần Quang Khải (Hà Nội)'],
    ['Beta Giải Phóng', 'Beta Giải Phóng (Hà Nội)'],
    ['Beta Mỹ Đình', 'Beta Mỹ Đình (Hà Nội)'],
    ['Beta Quang Trung', 'Beta Quang Trung (TP.HCM)'],
    ['Beta Ung Văn Khiêm', 'Beta Ung Văn Khiêm (TP.HCM)'],
    ['Beta Thái Nguyên', 'Beta Thái Nguyên'],
    ['Beta Bắc Giang', 'Beta Bắc Giang'],
    ['Beta Nha Trang', 'Beta Nha Trang']
  ];

  const MENU = [
    ['schedule', 'schedule.html', 'LỊCH CHIẾU THEO RẠP'],
    ['movies', 'home.html', 'PHIM'],
    ['price', 'schedule.html', 'GIÁ VÉ'],
    ['promos', 'home.html#promos', 'TIN MỚI & ƯU ĐÃI'],
    ['support', 'support.html', 'HỖ TRỢ'],
    ['member', 'account.html', 'THÀNH VIÊN']
  ];

  // Trang -> mục menu được tô sáng
  const ACTIVE_BY_PAGE = {
    home: 'movies', 'movie-detail': 'movies',
    schedule: 'schedule',
    support: 'support',
    account: 'member', refund: 'member', 'refund-track': 'member',
    'ticket-cancelled': 'member', 'ticket-refunded': 'member'
  };

  const DEMO_USER = { name: 'LƯƠNG HỒNG ANH', phone: '0987654321', email: 'luonghonganh@betacinemas.vn', dob: '2006-08-08' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pageName() {
    const f = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
    return f || 'index';
  }

  // Phiên đăng nhập demo: chưa có key -> coi như đã đăng nhập bằng tài khoản demo
  function getUser() {
    try {
      const raw = localStorage.getItem('BETA_USER');
      if (raw === null) return DEMO_USER;
      return JSON.parse(raw);
    } catch (e) {
      return DEMO_USER;
    }
  }

  function setUser(user) {
    try { localStorage.setItem('BETA_USER', JSON.stringify(user || null)); } catch (e) {}
  }

  function logout() {
    setUser(null);
    location.href = 'auth.html#login';
  }

  // Trang hiện tại dạng "account.html?x=y" (dùng cho ?next= sau khi đăng nhập)
  function currentPage() {
    return (location.pathname.split('/').pop() || 'index.html').replace(/^([^.]+)$/, '$1.html') + location.search;
  }

  // Gọi ở <head> của trang cần đăng nhập: chưa đăng nhập -> chuyển sang trang đăng nhập
  function requireLogin() {
    const u = getUser();
    if (!u || !u.name) {
      location.replace('auth.html?next=' + encodeURIComponent(currentPage()) + '#login');
      return false;
    }
    return true;
  }

  // Ghi HTML ngay trước thẻ <script> đang chạy
  function writeHere(html) {
    const s = document.currentScript;
    if (s && s.parentNode) s.insertAdjacentHTML('beforebegin', html);
    else document.body.insertAdjacentHTML('beforeend', html);
  }

  function topBar(opts) {
    const user = getUser();
    let links;
    if (opts.authPage) {
      links = `<a href="javascript:void(0)" onclick="switchToView('login')">Đăng nhập</a><span>|</span>
        <a href="javascript:void(0)" onclick="switchToView('register')">Đăng ký</a><span>|</span>
        <a href="betabot.html">Hỗ trợ CSKH</a>`;
    } else if (user && user.name) {
      links = `<span style="color: #005198;">Xin chào, <strong id="top-user-name">${esc(user.name)}</strong></span><span>|</span>
        <a href="account.html">Tài khoản</a><span>|</span>
        <a href="javascript:void(0)" onclick="Layout.logout()">Đăng xuất</a>`;
    } else {
      const next = encodeURIComponent(currentPage());
      links = `<a href="auth.html?next=${next}#login">Đăng nhập</a><span>|</span>
        <a href="auth.html?next=${next}#register">Đăng ký</a><span>|</span>
        <a href="betabot.html">Hỗ trợ CSKH</a>`;
    }
    return `
  <div class="top-header-official">
    <div class="container top-header-inner">
      <div>
        <span>📞 Hotline CSKH: <strong style="color: #005198;">1900 636 807</strong> (08:00 - 22:00)</span>
      </div>
      <div class="top-auth-links">${links}</div>
    </div>
  </div>`;
  }

  /**
   * opts.cinemaSelect:
   *   'nav'      (mặc định) chọn rạp -> chuyển sang lịch chiếu của rạp đó
   *   'booking'  <select id="cinema-select">, trang tự gắn sự kiện
   *   'schedule' <select id="schedule-cinema-select" onchange="changeCinema(...)">
   * opts.cinema: rạp được chọn sẵn (mặc định lấy từ ?cinema= hoặc Beta Thanh Xuân)
   */
  function cinemaSelect(opts) {
    const mode = opts.cinemaSelect || 'nav';
    const urlCinema = new URLSearchParams(location.search).get('cinema') || '';
    const wanted = urlCinema || opts.cinema || 'Beta Thanh Xuân';
    let selected = CINEMAS.find(c => wanted.indexOf(c[0]) === 0) || CINEMAS[0];

    const attrs = {
      nav: `onchange="location.href='schedule.html?cinema=' + encodeURIComponent(this.value)"`,
      booking: 'id="cinema-select"',
      schedule: 'id="schedule-cinema-select" onchange="changeCinema(this.value)"'
    }[mode];

    const options = CINEMAS.map(c =>
      `<option value="${esc(c[0])}"${c === selected ? ' selected' : ''}>${esc(c[1])}</option>`).join('');

    return `
      <div style="position: relative; flex-shrink: 0;">
        <select class="cinema-select-official" ${attrs}>${options}</select>
        <span style="position: absolute; right: 16px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #005198; font-size: 11px;">▼</span>
      </div>`;
  }

  function header(opts) {
    opts = opts || {};
    const active = opts.active || ACTIVE_BY_PAGE[pageName()] || '';
    const menu = MENU.map(m =>
      `<li><a href="${m[1]}" class="menu-link-official${m[0] === active ? ' active' : ''}">${m[2]}</a></li>`).join('\n          ');

    writeHere(`${topBar(opts)}
  <header class="header-main-official">
    <div class="container header-row">
      <a href="home.html" style="flex-shrink: 0;" aria-label="Beta Cinemas">
        <img class="official-logo" src="images/ui/logo.png"
             onerror="this.onerror=null; this.src='images/ui/logo-official.png';" alt="Beta Cinemas">
      </a>
      ${cinemaSelect(opts)}
      <button type="button" class="menu-toggle-official" aria-label="Mở menu" aria-expanded="false"
              onclick="Layout.toggleMenu(this)">☰</button>
      <nav class="main-nav-official">
        <ul class="main-menu-official">
          ${menu}
        </ul>
      </nav>
    </div>
  </header>`);
  }

  // Nút ☰ trên điện thoại: mở / đóng menu chính
  function toggleMenu(btn) {
    const header = btn.closest('.header-main-official');
    const open = header.classList.toggle('menu-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? '✕' : '☰';
  }

  function footer(opts) {
    opts = opts || {};
    const cinemaLinks = CINEMAS.filter(c => c[0] !== 'Beta Trần Quang Khải' && c[0] !== 'Beta Nha Trang')
      .map(c => `<li><a href="schedule.html?cinema=${encodeURIComponent(c[0])}">${esc(c[1])}</a></li>`).join('\n            ');
    const policy = ['Điều khoản sử dụng', 'Chính sách bảo mật thông tin', 'Chính sách đổi trả & hoàn tiền',
      'Quy định độ tuổi xem phim', 'Hướng dẫn thanh toán trực tuyến']
      .map(t => `<li><a href="support.html">${esc(t)}</a></li>`).join('\n            ');
    const chip = 'background: rgba(255,255,255,0.15); padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 700;';
    const pay = 'padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 800;';

    writeHere(`
  <footer class="footer-official"${opts.stickBottom ? ' style="margin-top: auto;"' : ''}>
    <div class="container">
      <div class="footer-official-grid">
        <div>
          <div style="margin-bottom: 18px;">
            <a href="home.html">
              <img src="images/ui/logo-white.png" onerror="this.onerror=null; this.src='images/ui/logo-white-official.png';"
                   alt="Beta Cinemas" style="height: 48px;">
            </a>
          </div>
          <p style="font-size: 13px; color: #e0f2fe; line-height: 1.8; margin-bottom: 16px;">
            <strong>CÔNG TY CỔ PHẦN BETA MEDIA</strong><br>
            Tầng 3, số 59 phố Xuân Diệu, Phường Quảng An, Quận Tây Hồ, Thành phố Hà Nội.<br>
            Mã số doanh nghiệp: 0106633482 do Sở KH&amp;ĐT TP. Hà Nội cấp.<br>
            Hotline: <strong>1900 636 807</strong> (08:00 - 22:00)
          </p>
          <div><img src="images/ui/dathongbao.png" alt="Đã Thông Báo Bộ Công Thương" style="height: 38px;"></div>
        </div>
        <div>
          <h4 class="footer-official-title">CỤM RẠP BETA CINEMAS</h4>
          <ul class="footer-official-links">
            ${cinemaLinks}
          </ul>
        </div>
        <div>
          <h4 class="footer-official-title">CHÍNH SÁCH & QUY ĐỊNH</h4>
          <ul class="footer-official-links">
            ${policy}
          </ul>
        </div>
        <div>
          <h4 class="footer-official-title">KẾT NỐI VỚI CHÚNG TÔI</h4>
          <p style="font-size: 13px; color: #e0f2fe; margin-bottom: 14px;">Theo dõi Fanpage Beta Cinemas để nhận ưu đãi vé 0đ sớm nhất:</p>
          <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <span style="${chip}">Facebook</span><span style="${chip}">TikTok</span><span style="${chip}">Youtube</span>
          </div>
          <h4 class="footer-official-title" style="margin-top: 10px;">ĐỐI TÁC THANH TOÁN</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            <span style="background: white; color: #005198; ${pay}">VietQR / SePay</span>
            <span style="background: white; color: #005198; ${pay}">VNPAY-QR</span>
            <span style="background: #a50064; color: white; ${pay}">MoMo</span>
          </div>
        </div>
      </div>
      <div class="footer-official-bottom">
        <div>© 2026 Beta Cinemas. Bản quyền thuộc về Công ty Cổ phần Beta Media.</div>
        <div><a href="support.html" style="color: #ffd166; font-weight: 600;">Trung tâm trợ giúp 24/7</a></div>
      </div>
    </div>
  </footer>`);
  }

  // ---------------------------------------------------------------------
  // QUICK-DOCK: nút nổi chuyển nhanh giữa các màn hình xử lý đơn (demo)
  // ---------------------------------------------------------------------
  const DOCK_ITEMS = [
    ['verify', '⏳ Xác Minh GD'],
    ['ticket-cancelled', '❌ Đơn Hủy'],
    ['refund', '💸 Hoàn Tiền'],
    ['ticket-refunded', '🎉 Đã Hoàn']
  ];

  function setDockOpen(open) {
    const nav = document.getElementById('quick-dock-nav');
    const fab = document.getElementById('btn-toggle-quick-dock');
    if (!nav || !fab) return;
    if (open) {
      nav.style.display = 'flex';
      setTimeout(() => nav.classList.add('show'), 10);
    } else {
      nav.classList.remove('show');
      setTimeout(() => { nav.style.display = 'none'; }, 200);
    }
    fab.classList.toggle('active', open);
    fab.querySelector('.fab-icon-open').style.display = open ? 'none' : 'inline';
    fab.querySelector('.fab-icon-close').style.display = open ? 'inline' : 'none';
    try { localStorage.setItem('quick_dock_state', open ? 'open' : 'closed'); } catch (e) {}
  }

  function toggleQuickDock() {
    const nav = document.getElementById('quick-dock-nav');
    if (nav) setDockOpen(nav.style.display === 'none' || !nav.classList.contains('show'));
  }

  function mountQuickDock() {
    if (document.getElementById('quick-dock-widget')) return;

    // Giữ nguyên tham số đơn hàng hiện tại khi chuyển màn hình
    const cur = new URLSearchParams(location.search);
    let lastOrder = null;
    try {
      if (cur.get('order')) localStorage.setItem('last_active_order', cur.get('order'));
      lastOrder = localStorage.getItem('last_active_order');
    } catch (e) {}
    const query = new URLSearchParams({
      order: cur.get('order') || lastOrder || 'BC1317376612',
      total: cur.get('total') || '90000',
      movie: cur.get('movie') || 'quy-an-tang-4',
      cinema: cur.get('cinema') || 'Beta Thanh Xuân (Hà Nội)',
      seats: cur.get('seats') || 'D5, D6',
      date: cur.get('date') || 'Hôm nay',
      time: cur.get('time') || '18:30'
    }).toString();

    const page = pageName();
    const items = DOCK_ITEMS.map(([p, label]) =>
      `<a href="${p}.html?${query}" class="dock-item${p === page ? ' active' : ''}" data-page="${p}">${label}</a>`).join('');

    document.body.insertAdjacentHTML('beforeend', `
  <div id="quick-dock-widget" class="quick-dock-widget">
    <button type="button" id="btn-toggle-quick-dock" class="quick-dock-fab" onclick="toggleQuickDock()" title="Mở thanh chuyển đổi giao diện">
      <span class="fab-icon-open">⚡</span><span class="fab-icon-close" style="display: none;">✕</span>
      <span class="fab-badge">${DOCK_ITEMS.length}</span>
    </button>
    <nav id="quick-dock-nav" class="prototype-dock quick-dock-menu" style="display: none;">
      <span class="dock-label">GIAO DIỆN:</span>${items}
      <button type="button" class="dock-close-pill" onclick="toggleQuickDock()" title="Thu gọn">✕</button>
    </nav>
  </div>`);

    try { if (localStorage.getItem('quick_dock_state') === 'open') setDockOpen(true); } catch (e) {}

    // Đóng khi click ra ngoài
    document.addEventListener('click', e => {
      const widget = document.getElementById('quick-dock-widget');
      const nav = document.getElementById('quick-dock-nav');
      if (widget && nav && nav.style.display !== 'none' && !widget.contains(e.target)) setDockOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountQuickDock);
  else mountQuickDock();

  window.toggleQuickDock = toggleQuickDock;
  window.Layout = { header, footer, toggleMenu, getUser, setUser, logout, requireLogin, CINEMAS };
})();
