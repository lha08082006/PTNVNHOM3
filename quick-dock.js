/**
 * quick-dock.js - Nút nổi điều hướng góc màn hình (Floating Action Button)
 * Chỉ giữ 3 nút chức năng quan trọng: Xác Minh GD, Đơn Hủy, Hoàn Tiền
 * Tự động đồng bộ và giữ nguyên tham số đơn hàng (order, total, movie, cinema, seats)
 */

function toggleQuickDock() {
  const nav = document.getElementById('quick-dock-nav');
  const fab = document.getElementById('btn-toggle-quick-dock');
  if (!nav || !fab) return;

  const isClosed = nav.style.display === 'none' || !nav.classList.contains('show');
  if (isClosed) {
    nav.style.display = 'flex';
    setTimeout(() => nav.classList.add('show'), 10);
    fab.classList.add('active');
    const openIcon = fab.querySelector('.fab-icon-open');
    const closeIcon = fab.querySelector('.fab-icon-close');
    if (openIcon) openIcon.style.display = 'none';
    if (closeIcon) closeIcon.style.display = 'inline';
    localStorage.setItem('quick_dock_state', 'open');
  } else {
    nav.classList.remove('show');
    setTimeout(() => { nav.style.display = 'none'; }, 200);
    fab.classList.remove('active');
    const openIcon = fab.querySelector('.fab-icon-open');
    const closeIcon = fab.querySelector('.fab-icon-close');
    if (openIcon) openIcon.style.display = 'inline';
    if (closeIcon) closeIcon.style.display = 'none';
    localStorage.setItem('quick_dock_state', 'closed');
  }
}
window.toggleQuickDock = toggleQuickDock;

(function initQuickDock() {
  function setupLinks() {
    // 1. Thu thập tham số đơn hàng từ URL hoặc localStorage
    const curParams = new URLSearchParams(window.location.search);
    const order = curParams.get('order') || localStorage.getItem('last_active_order') || 'BC1317376612';
    const total = curParams.get('total') || '90000';
    const movie = curParams.get('movie') || 'quy-an-tang-4';
    const cinema = curParams.get('cinema') || 'Beta Thanh Xuân (Hà Nội)';
    const seats = curParams.get('seats') || 'D5, D6';
    const date = curParams.get('date') || 'Hôm nay';
    const time = curParams.get('time') || '18:30';

    if (curParams.get('order')) {
      localStorage.setItem('last_active_order', curParams.get('order'));
    }

    const query = new URLSearchParams({
      order,
      total,
      movie,
      cinema,
      seats,
      date,
      time
    }).toString();

    // 2. Gán link chính xác kèm dữ liệu vào đúng 3 nút
    const links = {
      'verify': `verify.html?${query}`,
      'ticket-cancelled': `ticket-cancelled.html?${query}`,
      'refund': `refund.html?${query}`,
      'ticket-refunded': `ticket-refunded.html?${query}`
    };

    const nav = document.getElementById('quick-dock-nav');
    if (!nav) return;

    nav.querySelectorAll('.dock-item').forEach(item => {
      const p = item.getAttribute('data-page');
      if (links[p]) {
        item.href = links[p];
      }

      // Đánh dấu nút active của trang hiện tại
      const curPath = (window.location.pathname || '').toLowerCase();
      if ((p === 'verify' && curPath.includes('verify')) ||
          (p === 'ticket-cancelled' && curPath.includes('ticket-cancelled')) ||
          (p === 'refund' && curPath.includes('refund') && !curPath.includes('refund-track') && !curPath.includes('ticket-refunded')) ||
          (p === 'ticket-refunded' && curPath.includes('ticket-refunded'))) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // 3. Khôi phục trạng thái mở/đóng nếu trước đó đang mở
    if (localStorage.getItem('quick_dock_state') === 'open') {
      const fab = document.getElementById('btn-toggle-quick-dock');
      if (nav && fab) {
        nav.style.display = 'flex';
        nav.classList.add('show');
        fab.classList.add('active');
        const openIcon = fab.querySelector('.fab-icon-open');
        const closeIcon = fab.querySelector('.fab-icon-close');
        if (openIcon) openIcon.style.display = 'none';
        if (closeIcon) closeIcon.style.display = 'inline';
      }
    }
  }

  // Đóng khi click ra ngoài
  document.addEventListener('click', (e) => {
    const widget = document.getElementById('quick-dock-widget');
    const nav = document.getElementById('quick-dock-nav');
    if (widget && nav && nav.style.display !== 'none' && !widget.contains(e.target)) {
      toggleQuickDock();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLinks);
  } else {
    setupLinks();
  }
})();
