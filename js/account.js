// js/account.js - mã của account.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// =========================================================================
// TRANG THÀNH VIÊN: hồ sơ thật (BetaAuth) + lịch sử đơn thật (/api/orders)
// =========================================================================
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let currentFilter = 'all';
let searchQuery = '';
let ORDERS = [];

// Nhóm bộ lọc theo trạng thái thật của đơn
const STATUS_STYLE = {
  PENDING:          { group: 'cancelled',  bg: '#fef3c7', fg: '#92400e', bd: '#fde68a', bar: '#f59e0b', icon: '<i class=ph-hourglass-medium aria-hidden=true></i>' },
  EXPIRED:          { group: 'unrefunded', bg: '#fef3c7', fg: '#92400e', bd: '#fde68a', bar: '#f59e0b', icon: '<i class=ph-magnifying-glass aria-hidden=true></i>' },
  CONFIRMED:        { group: 'upcoming',   bg: '#d1fae5', fg: '#065f46', bd: '#a7f3d0', bar: '#047857', icon: '<i class=ph-check aria-hidden=true></i>' },
  CONFIRMED_LATE:   { group: 'upcoming',   bg: '#d1fae5', fg: '#065f46', bd: '#a7f3d0', bar: '#047857', icon: '<i class=ph-check aria-hidden=true></i>' },
  REFUND_REQUESTED: { group: 'unrefunded', bg: '#dbeafe', fg: '#1e40af', bd: '#bfdbfe', bar: '#3b82f6', icon: '<i class=ph-money-wavy aria-hidden=true></i>' },
  MANUAL_REVIEW:    { group: 'unrefunded', bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5', bar: '#ef4444', icon: '<i class=ph-note-pencil aria-hidden=true></i>' },
  REFUNDED:         { group: 'refunded',   bg: '#e0e7ff', fg: '#3730a3', bd: '#c7d2fe', bar: '#6366f1', icon: '<i class=ph-check aria-hidden=true></i>' },
  CANCELLED:        { group: 'cancelled',  bg: '#f1f5f9', fg: '#475569', bd: '#cbd5e1', bar: '#64748b', icon: '<i class=ph-x aria-hidden=true></i>' },
  FAILED:           { group: 'cancelled',  bg: '#f1f5f9', fg: '#475569', bd: '#cbd5e1', bar: '#64748b', icon: '<i class=ph-x aria-hidden=true></i>' }
};

function groupOf(o) {
  const g = (STATUS_STYLE[o.status] || STATUS_STYLE.CANCELLED).group;
  if (g === 'upcoming' && o.show_at && new Date(o.show_at) < new Date()) return 'completed';
  return g;
}

function applyOrderFilter(filterType, btnEl) {
  currentFilter = filterType;
  document.querySelectorAll('.filter-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderOrders();
}

function searchOrders(query) {
  searchQuery = query.trim().toLowerCase();
  renderOrders();
}

function orderActions(o) {
  const c = encodeURIComponent(o.code);
  const stop = 'data-on-click="event.stopPropagation();"';
  let html = '';
  if (o.has_ticket) {
    html += `<a href="ticket.html?order=${c}" class="btn btn-primary btn-sm" ${stop} style="background: #005198; border-color: #005198; font-weight: 700;"><i class=ph-ticket aria-hidden=true></i> Xem vé</a>`;
    html += `<a href="invoice.html?order=${c}" class="btn btn-outline btn-sm" ${stop} style="font-weight: 700;"><i class=ph-receipt aria-hidden=true></i> Hóa đơn</a>`;
  } else if (o.status === 'PENDING') {
    html += `<a href="${Pay.routeFor(o)}" class="btn btn-primary btn-sm" ${stop} style="background: #c2410c; border-color: #c2410c; font-weight: 700;"><i class=ph-device-mobile aria-hidden=true></i> Tiếp tục thanh toán</a>`;
  } else if (o.refund && o.refund.needs_form) {
    html += `<a href="refund.html?order=${c}" class="btn btn-primary btn-sm" ${stop} style="background: #dc2626; border-color: #dc2626; font-weight: 700;"><i class=ph-note-pencil aria-hidden=true></i> Điền biểu mẫu nhận hoàn tiền</a>`;
  }
  html += `<a href="order.html?code=${c}" class="btn btn-outline btn-sm" ${stop} style="border-color: #005198; color: #005198; font-weight: 700;"><i class=ph-trend-up aria-hidden=true></i> Theo dõi đơn hàng</a>`;
  // Đặt lại một chạm (Đợt 5): vé -> trang phim chọn suất mới; bắp nước -> giỏ cùng món
  const combos = Object.fromEntries(Object.entries(o.combos || {}).filter(([, q]) => q > 0));
  if (o.kind === 'FNB') html += `<a href="bap-nuoc.html?combos=${encodeURIComponent(JSON.stringify(combos))}" class="btn btn-outline btn-sm" ${stop} style="font-weight: 700;"><i class=ph-repeat aria-hidden=true></i> Đặt lại</a>`;
  else if (o.movie_key) html += `<a href="phim/${encodeURIComponent(o.movie_key)}#booking-area" class="btn btn-outline btn-sm" ${stop} style="font-weight: 700;"><i class=ph-repeat aria-hidden=true></i> Đặt lại phim này</a>`;
  return html;
}

function refundMini(o) {
  const r = o.refund;
  if (!r) return '';
  const dots = r.steps.map(s => `<span title="${esc(s.label)}" style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: ${s.done ? '#166534' : '#94a3b8'}; font-weight: ${s.done ? 700 : 500};"><span style="width: 14px; height: 14px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 12px; background: ${s.done ? '#15803d' : '#e2e8f0'}; color: #fff;">${s.done ? '<i class=ph-check aria-hidden=true></i>' : ''}</span>${esc(s.label)}</span>`).join('<span style="color: #cbd5e1;">—</span>');
  return `<div style="margin: -4px 0 12px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
        <div style="font-size: 12px; color: #475569; margin-bottom: 6px;"><i class=ph-money-wavy aria-hidden=true></i> Hoàn <strong>${Pay.vnd(r.amount)}</strong> · ${esc(r.reason_label)}${r.is_manual ? ' · thủ công' : ' · tự động'}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">${dots}</div>
      </div>`;
}

function orderCard(o) {
  const st = STATUS_STYLE[o.status] || STATUS_STYLE.CANCELLED;
  const m = Pay.movieOf(o);
  const card = document.createElement('div');
  card.className = 'order-history-item';
  card.dataset.code = o.code;
  card.style.cssText = `border-left: 4px solid ${st.bar}; background: #fff;`;
  card.title = 'Bấm để theo dõi đơn hàng';
  card.onclick = () => { location.href = 'order.html?code=' + encodeURIComponent(o.code); };
  card.innerHTML = `
        <img loading="lazy" decoding="async" class="order-item-poster" src="${esc(m.poster)}" alt="" data-fallback="images/400x633-145627-230926-40.jpg">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <div>
              <span class="badge" style="background: ${st.bg}; color: ${st.fg}; border: 1px solid ${st.bd}; font-size: 12px; font-weight: 800;">${st.icon} ${esc(o.status_label).toUpperCase()}</span>
              <h4 style="font-family: var(--font-display); font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 6px;">${esc(m.title)}</h4>
              ${o.status_sublabel ? `<div style="font-size: 12px; color: #64748b;">${esc(o.status_sublabel)}</div>` : ''}
            </div>
            <div style="text-align: right;">
              <div style="font-size: 12px; color: #64748b;">Mã đơn:</div>
              <strong style="font-family: monospace; font-size: 14px; color: #005198;">${esc(o.code)}</strong>
            </div>
          </div>
          <div style="font-size: 13px; color: #475569; margin-bottom: 12px; line-height: 1.6;">
            <i class=ph-map-pin aria-hidden=true></i> Rạp: <strong>${esc(o.cinema)}</strong><br>
            ${o.kind === 'FNB' ? '<i class=ph-popcorn aria-hidden=true></i> <strong>Nhận tại quầy trong 30 ngày</strong><br>' : `<i class=ph-clock aria-hidden=true></i> Suất: <strong>${esc(o.show_time)} • ${esc(o.show_date)}</strong><br>`}
            <i class=ph-calendar aria-hidden=true></i> Thời gian đặt vé: <strong>${new Date(o.created_at).toLocaleString('vi-VN')}</strong><br>
            ${o.kind === 'FNB' ? '' : `<i class=ph-armchair aria-hidden=true></i> Ghế: <strong>${esc((o.seats || []).join(', '))}</strong><br>`}${o.points_used ? `<i class=ph-coins aria-hidden=true></i> Dùng <strong>${o.points_used}</strong> điểm<br>` : ''}${o.points_earned ? `<i class=ph-coins aria-hidden=true></i> Tích <strong>+${o.points_earned}</strong> điểm Beta Club<br>` : ''}
            <i class=ph-credit-card aria-hidden=true></i> Giá trị đơn: <strong>${Pay.vnd(o.total)}</strong> · Đã nhận: <strong>${Pay.vnd(o.paid_amount)}</strong>
          </div>
          ${refundMini(o)}
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">${orderActions(o)}</div>
        </div>`;
  return card;
}

function renderOrders() {
  const wrapper = document.getElementById('orders-list-wrapper');
  const empty = document.getElementById('orders-empty-state');
  wrapper.querySelectorAll('.order-history-item').forEach(el => el.remove());

  const counts = { all: ORDERS.length, upcoming: 0, completed: 0, cancelled: 0, unrefunded: 0, refunded: 0 };
  ORDERS.forEach(o => { counts[groupOf(o)]++; });
  Object.keys(counts).forEach(k => { const el = document.getElementById('count-' + k); if (el) el.textContent = counts[k]; });
  document.getElementById('total-orders-count').textContent = counts.all;

  const visible = ORDERS
    .filter(o => currentFilter === 'all' || groupOf(o) === currentFilter)
    .filter(o => {
      if (!searchQuery) return true;
      const m = Pay.movieOf(o);
      return [m.title, m.shortTitle, o.code, o.cinema, (o.seats || []).join(' ')].join(' ').toLowerCase().includes(searchQuery);
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  visible.forEach(o => wrapper.insertBefore(orderCard(o), empty));

  empty.style.display = visible.length ? 'none' : 'block';
  empty.querySelector('h4').textContent = ORDERS.length ? 'Không tìm thấy đơn hàng nào phù hợp' : 'Bạn chưa có đơn hàng nào';
  empty.querySelector('p').textContent = ORDERS.length
    ? 'Vui lòng thử lại với từ khóa khác hoặc chuyển sang tab "Tất cả".'
    : 'Chọn phim và suất chiếu để đặt vé đầu tiên của bạn.';

  // Thẻ thành viên: tổng chi tiêu từ các đơn đã xuất vé
  const paid = ORDERS.filter(o => o.has_ticket);
  document.getElementById('member-spend').textContent = Pay.vnd(paid.reduce((s, o) => s + (o.total || 0), 0));
  document.getElementById('member-paid-count').textContent = paid.length;
}

async function loadOrders() {
  const l = document.getElementById('orders-loading');
  try {
    ORDERS = await Pay.getOrders({ limit: 50 });
    l.style.display = 'none';
    renderOrders();
  } catch (e) {
    l.style.display = 'block';
    l.textContent = 'Không tải được lịch sử đơn hàng (' + e.message + '). Hệ thống sẽ tự thử lại.';
  }
}

function switchAccountTab(tab) {
  if (!['orders', 'movies', 'points', 'profile', 'password'].includes(tab)) tab = 'orders';
  document.querySelectorAll('.account-nav-btn').forEach(btn => btn.classList.remove('active'));
  ['orders', 'movies', 'points', 'profile', 'password'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? 'block' : 'none';
  });
  document.getElementById('btn-tab-' + tab).classList.add('active');
  document.getElementById('panel-privacy').style.display = tab === 'profile' ? 'block' : 'none';
}

function showMsg(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.style.color = ok ? '#15803d' : '#dc2626';
  el.style.display = 'block';
}
function hideMsg(id) { const el = document.getElementById(id); if (el) { el.textContent = ''; el.style.display = 'none'; } }
// Mỗi lần sửa ô hoặc bấm nút: xóa thông báo cũ (kể cả khi trình duyệt tự chặn lần bấm vì ô trống / quá ngắn)
[['password-form', 'password-msg'], ['profile-form', 'profile-msg']].forEach(([f, m]) => {
  const form = document.getElementById(f);
  if (!form) return;
  form.addEventListener('input', () => hideMsg(m));
  const sb = form.querySelector('[type=submit]');
  if (sb) sb.addEventListener('click', () => hideMsg(m));
});
(function () {
  const bd = document.getElementById('pf-birthday');
  if (bd && window.BetaAuth && BetaAuth.check) { bd.min = BetaAuth.check.MIN_BIRTHDAY; bd.max = BetaAuth.check.today(); }
})();

// Quyền với dữ liệu cá nhân (Đợt 6)
async function exportMyData() {
  const msg = document.getElementById('pv-msg');
  try {
    const r = await fetch(Pay.getApiBase() + 'auth?action=export', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('BETA_AUTH_TOKEN') || '') } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = 'du-lieu-cua-toi_beta-cinemas.json';
    document.body.appendChild(a); a.click(); a.remove();
    msg.style.color = '#15803d'; msg.textContent = '✓ Đã tải file dữ liệu của bạn.';
  } catch (e) { msg.style.color = '#b91c1c'; msg.textContent = e.message; }
}
async function deleteMyAccount() {
  const msg = document.getElementById('pv-msg');
  const confirmText = prompt('Xóa tài khoản không khôi phục được. Điểm Beta Club sẽ mất. Gõ XOA để tiếp tục:');
  if (confirmText == null) return;
  const password = prompt('Nhập mật khẩu để xác nhận:');
  if (!password) return;
  try {
    await Pay.post('auth?action=delete', { password, confirm: confirmText });
    try { localStorage.removeItem('BETA_AUTH_TOKEN'); localStorage.removeItem('BETA_AUTH_USER'); } catch (e) {}
    alert('Tài khoản đã được xóa. Cảm ơn bạn đã đồng hành cùng Beta Cinemas.');
    location.href = 'home.html';
  } catch (e) { msg.style.color = '#b91c1c'; msg.textContent = e.message; }
}

async function saveProfile() {
  const btn = document.getElementById('btn-save-profile');
  // Cùng luật với máy chủ; chỉ kiểm tra ô khách thật sự đổi (thông tin cũ không làm kẹt việc sửa ô khác)
  const u = BetaAuth.cachedUser() || {}, ck = BetaAuth.check;
  const name = document.getElementById('pf-name').value, phone = document.getElementById('pf-phone').value;
  const bdEl = document.getElementById('pf-birthday'), bd = bdEl.value;
  const bad = !ck ? '' : (ck.normName(name) !== (u.full_name || '') ? ck.name(name) : '') ||
    (ck.normPhone(phone) !== (u.phone || '') ? ck.phone(phone) : '') ||
    ((bd || null) !== (u.birthday || null) || (bdEl.validity && bdEl.validity.badInput) ? ck.birthday(bd, bdEl) : '');
  if (bad) return showMsg('profile-msg', bad, false);
  btn.disabled = true;
  try {
    await BetaAuth.updateProfile({
      full_name: document.getElementById('pf-name').value,
      phone: document.getElementById('pf-phone').value,
      birthday: document.getElementById('pf-birthday').value,
      marketing_opt_in: document.getElementById('pf-marketing').checked
    });
    showMsg('profile-msg', '✓ Đã lưu thông tin cá nhân.', true);
  } catch (e) {
    showMsg('profile-msg', e.message, false);
  } finally {
    btn.disabled = false;
  }
}

async function savePassword() {
  const cur = document.getElementById('pw-current').value;
  const nw = document.getElementById('pw-new').value;
  if (nw !== document.getElementById('pw-new2').value) return showMsg('password-msg', 'Mật khẩu xác nhận không khớp.', false);
  const weak = BetaAuth.check ? BetaAuth.check.newPassword(cur, nw) : '';
  if (weak) return showMsg('password-msg', weak, false);
  const btn = document.getElementById('btn-save-password');
  btn.disabled = true;
  try {
    await BetaAuth.changePassword(cur, nw);
    document.getElementById('password-form').reset();
    showMsg('password-msg', '✓ Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.', true);
  } catch (e) {
    showMsg('password-msg', e.message, false);
  } finally {
    btn.disabled = false;
  }
}

// Phim của tôi (Đợt 5): yêu thích + đã xem (đơn đã soát vé)
async function loadMyMovies() {
  try {
    const [f, h] = await Promise.all([Pay.call('member?action=favorites'), Pay.call('member?action=history')]);
    document.getElementById('mv-favs').innerHTML = f.favorites.length ? f.favorites.map(m => `
          <div style="text-align: center;">
            <a href="phim/${encodeURIComponent(m.key)}"><img src="${esc(m.poster || 'images/logo-official.png')}" alt="" loading="lazy" style="width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 10px; background: #e2e8f0;"></a>
            <a href="phim/${encodeURIComponent(m.key)}" style="display: block; font-size: 13px; font-weight: 700; color: #0f172a; margin: 6px 0 4px; text-decoration: none;">${esc(m.title)}</a>
            <button type="button" class="btn btn-outline btn-sm" data-on-click="unFav('${esc(m.key)}')">Bỏ yêu thích</button>
          </div>`).join('') : '<p style="color: #64748b; font-size: 13.5px;">Chưa có phim yêu thích. Bấm ♡ Yêu thích ở trang phim để lưu lại.</p>';
    document.getElementById('mv-history').innerHTML = h.history.length ? h.history.map(x => `
          <div style="display: flex; gap: 12px; align-items: center; border-top: 1px solid #f1f5f9; padding: 10px 0;">
            <img src="${esc(x.poster || 'images/logo-official.png')}" alt="" loading="lazy" style="width: 46px; height: 68px; object-fit: cover; border-radius: 6px; background: #e2e8f0;">
            <div style="flex: 1; min-width: 0;"><b style="font-size: 14px;">${esc(x.title)}</b>
              <div style="font-size: 12.5px; color: #64748b;">${esc(x.cinema)} · ${esc(x.show_time)} ${esc(x.show_date)}</div></div>
            ${x.my_rating ? `<span style="color: #f59e0b; font-weight: 800;" aria-label="Bạn chấm ${x.my_rating} sao">${'★'.repeat(x.my_rating)}</span>` : `<a class="btn btn-outline btn-sm" href="phim/${encodeURIComponent(x.movie_key)}#reviews">Đánh giá</a>`}
          </div>`).join('') : '<p style="color: #64748b; font-size: 13.5px;">Chưa có phim đã xem (tính khi vé được soát tại rạp).</p>';
  } catch (e) { document.getElementById('mv-favs').innerHTML = '<p style="color: #b91c1c;">' + esc(e.message) + '</p>'; }
}
async function unFav(key) {
  try { await Pay.post('member?action=favorite', { movie: key, on: false }); loadMyMovies(); } catch (e) { alert(e.message); }
}

// Beta Club: điểm, hạng, lịch sử điểm
async function loadPoints() {
  try {
    const p = await Pay.call('member?action=points');
    const vnd = Pay.vnd;
    document.getElementById('member-tier').textContent = 'BETA ' + p.tier.label.toUpperCase();
    document.getElementById('member-points').textContent = p.balance.toLocaleString('vi-VN');
    const box = (label, value, sub) => `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px;"><div style="font-size: 12px; color: #64748b; text-transform: uppercase;">${label}</div><div style="font-size: 22px; font-weight: 900; color: var(--beta-navy);">${value}</div><div style="font-size: 12.5px; color: #475569;">${sub}</div></div>`;
    document.getElementById('pt-summary').innerHTML =
      box('Điểm hiện có', p.balance.toLocaleString('vi-VN'), '= ' + vnd(p.balance_value) + ' khi trả tiền') +
      box('Hạng', p.tier.label, 'Tích ' + p.tier.ticket + '% vé, ' + p.tier.fnb + '% bắp nước') +
      box('Chi tiêu 12 tháng', vnd(p.spend_365), 'Dùng để xét hạng') +
      (p.expiring_soon ? box('Sắp hết hạn', p.expiring_soon.toLocaleString('vi-VN'), 'điểm hết hạn trong 30 ngày') : '');
    document.getElementById('pt-next').innerHTML = p.next_tier
      ? `<div style="font-size: 13.5px; color: #334155; margin-bottom: 6px;">Chi tiêu thêm <strong>${vnd(p.next_tier.need)}</strong> để lên hạng <strong>${p.next_tier.label}</strong> (tích ${p.next_tier.ticket}% vé).</div>
             <div style="height: 8px; background: #e2e8f0; border-radius: 99px; overflow: hidden;" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.spend_365 / p.next_tier.min * 100)}"><div style="height: 100%; width: ${Math.min(100, p.spend_365 / p.next_tier.min * 100)}%; background: #f59e0b;"></div></div>`
      : '<div style="font-size: 13.5px; color: #15803d; font-weight: 700;">Bạn đang ở hạng cao nhất.</div>';
    const R = p.rules;
    document.getElementById('pt-rules').innerHTML = `<ul style="margin: 0; padding-left: 18px;">
          ${R.TIERS.map(t => `<li><b>${t.label}</b>${t.min ? ' (chi tiêu từ ' + vnd(t.min) + '/12 tháng)' : ''}: tích ${t.ticket}% tiền vé, ${t.fnb}% tiền bắp nước.</li>`).join('')}
          <li>1 điểm = ${vnd(R.POINT_VALUE)} khi thanh toán; dùng tối đa ${Math.round(R.MAX_SHARE * 100)}% giá trị mỗi đơn.</li>
          <li>Điểm được cộng khi đơn xuất vé, hết hạn sau ${R.EXPIRE_MONTHS} tháng (điểm sắp hết hạn được dùng trước).</li>
          <li>Đơn không thành công (hủy, hoàn tiền) được trả lại điểm đã dùng.</li>
          <li>Tháng sinh nhật: tặng ${R.BIRTHDAY_POINTS} điểm, dùng trong ${R.BIRTHDAY_DAYS} ngày (cập nhật ngày sinh ở Thông tin cá nhân).</li></ul>`;
    document.getElementById('pt-history').innerHTML = p.history.length
      ? `<table style="width: 100%; border-collapse: collapse; font-size: 13.5px;"><thead><tr style="text-align: left; color: #64748b;"><th style="padding: 6px;">Ngày</th><th style="padding: 6px;">Nội dung</th><th style="padding: 6px; text-align: right;">Điểm</th></tr></thead><tbody>${
          p.history.map(h => `<tr style="border-top: 1px solid #f1f5f9;"><td style="padding: 6px; white-space: nowrap;">${new Date(h.at).toLocaleDateString('vi-VN')}</td>
                <td style="padding: 6px;"><b>${esc(h.kind_label)}</b>${h.order_code ? ' · ' + esc(h.order_code) : ''}<div style="color: #64748b; font-size: 12px;">${esc(h.note)}${h.expires_at && h.points > 0 ? ' · hạn ' + new Date(h.expires_at).toLocaleDateString('vi-VN') : ''}</div></td>
                <td style="padding: 6px; text-align: right; font-weight: 800; color: ${h.points > 0 ? '#15803d' : '#b91c1c'};">${h.points > 0 ? '+' : ''}${h.points}</td></tr>`).join('')}</tbody></table>`
      : '<p style="color: #64748b; font-size: 13.5px;">Chưa có điểm. Đặt vé để bắt đầu tích điểm.</p>';
  } catch (e) {
    document.getElementById('pt-history').innerHTML = '<p style="color: #b91c1c;">Không tải được điểm: ' + esc(e.message) + '</p>';
  }
}

(async function init() {
  const u = await BetaAuth.requireLogin();
  document.getElementById('pf-marketing').checked = !!u.marketing_opt_in;
  if (u.terms_accepted_at) document.getElementById('pv-terms').textContent = 'ngày ' + new Date(u.terms_accepted_at).toLocaleDateString('vi-VN') + ' (phiên bản ' + (u.terms_version || '') + ')';
  document.getElementById('member-card-id').textContent = String(u.id || '').replace(/-/g, '').slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  document.getElementById('member-since').textContent = u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—';
  switchAccountTab(new URLSearchParams(location.search).get('tab') || 'orders');
  loadPoints();
  loadMyMovies();
  await loadOrders();
  setInterval(() => { if (!document.hidden) loadOrders(); }, 20000);
})();
// Nút "Xem tất cả đơn" (data-on-click="showAllOrders()")
function showAllOrders() { applyOrderFilter('all', document.querySelector('.filter-tab-btn[data-filter="all"]')); }
