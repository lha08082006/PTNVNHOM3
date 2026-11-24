// js/movie-fav.js - mã của movie-detail.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Phim yêu thích (Đợt 5): nút cạnh "Đặt vé" – cần đăng nhập
document.addEventListener('md:movie', async (ev) => {
  const m = ev.detail;
  const anchor = document.getElementById('md-trailer-btn') || document.getElementById('md-book-btn');
  if (!anchor || document.getElementById('md-fav')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'md-fav'; b.className = 'btn btn-outline btn-lg';
  b.style.cssText = 'color: white; border-color: rgba(255,255,255,0.4);';
  anchor.after(b);
  let token = null;
  try { token = localStorage.getItem('BETA_AUTH_TOKEN'); } catch (e) {}
  const paint = (on) => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '♥ Đã yêu thích' : '♡ Yêu thích'; };
  let on = false;
  if (token) { try { on = (await Pay.call('member?action=favorites')).favorites.some(f => f.key === m.key); } catch (e) {} }
  paint(on);
  b.onclick = async () => {
    if (!token) { location.href = BetaAuth.loginUrl(); return; }
    try { on = (await Pay.post('member?action=favorite', { movie: m.key, on: !on })).favorites.some(f => f.key === m.key); paint(on); } catch (e) { alert(e.message); }
  };
});

// "Nhắc tôi khi mở bán": phim chưa có suất -> khách đăng ký nhận email khi có lịch chiếu (Đợt 3)
document.addEventListener('md:noshow', async (ev) => {
  const m = ev.detail;
  const box = document.getElementById('md-watch');
  let token = null;
  try { token = localStorage.getItem('BETA_AUTH_TOKEN'); } catch (e) {}
  const paint = (on) => {
    box.innerHTML = '<button type="button" class="btn ' + (on ? 'btn-outline' : 'btn-primary') + '" id="md-watch-btn" aria-pressed="' + on + '">' + (on ? '✓ Sẽ báo bạn qua email khi mở bán · Tắt nhắc' : 'Nhắc tôi khi mở bán vé') + '</button>';
    document.getElementById('md-watch-btn').onclick = async () => {
      if (!token) { location.href = BetaAuth.loginUrl(); return; }
      try { paint((await Pay.post('member?action=watch', { movie: m.key, on: !on })).watching); } catch (e) { alert(e.message); }
    };
  };
  if (!token) return paint(false);
  try { paint((await Pay.call('member?action=watch&movie=' + encodeURIComponent(m.key))).watching); } catch (e) { paint(false); }
});

// Đợt 9: "Có thể bạn cũng thích" – phim trùng thể loại, ưu tiên đang chiếu và bán chạy
document.addEventListener('md:movie', async (ev) => {
  const m = ev.detail;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const gs = (x) => String(x.genre || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const mine = new Set(gs(m));
  try {
    const { movies } = await Pay.catalog('movies');
    let stats = {};
    try { stats = (await Pay.catalog('movie_stats')).stats || {}; } catch (e) { /* không có xếp hạng */ }
    const rank = (x) => (stats[x.key] && stats[x.key].rank) || 99;
    const pool = movies.filter(x => x.key !== m.key && x.status !== 'HIDDEN')
      .map(x => ({ x, s: gs(x).filter(g => mine.has(g)).length }))
      .sort((a, b) => b.s - a.s || (a.x.status === 'SOON') - (b.x.status === 'SOON') || rank(a.x) - rank(b.x));
    const pick = pool.slice(0, 4).map(o => o.x);
    if (!pick.length) return;
    document.getElementById('rel-title').textContent = pool[0].s > 0 ? 'Phim cùng thể loại' : 'Phim đang chiếu khác';
    document.getElementById('rel-grid').innerHTML = pick.map(x => {
      const s = stats[x.key];
      return `<article class="rel-card">
            <a class="pw" href="phim/${encodeURIComponent(x.key)}" tabindex="-1" aria-hidden="true"><img src="${esc(x.poster)}" alt="" loading="lazy" data-fallback="hide">${s && s.avg != null ? `<span class="movie-rating"><i class="ph-star" aria-hidden="true"></i>${s.avg.toFixed(1)}</span>` : ''}</a>
            <div class="bd"><b><a href="phim/${encodeURIComponent(x.key)}">${esc(x.title)}</a></b>
              <small>${esc([x.genre, x.duration_min ? x.duration_min + ' phút' : '', x.age].filter(Boolean).join(' · '))}</small>
              <div class="movie-actions"><a class="ma-buy" href="booking.html?movie=${encodeURIComponent(x.key)}"><i class="ph-ticket" aria-hidden="true"></i> ${x.status === 'SOON' ? 'Đặt trước' : 'Mua vé'}</a></div>
            </div></article>`;
    }).join('');
    document.getElementById('related').hidden = false;
  } catch (e) { /* không hiện mục gợi ý */ }
});

// Đánh giá phim: danh sách công khai + form cho khách đã soát vé (mỗi đơn vé một đánh giá)
document.addEventListener('md:movie', async (ev) => {
  const m = ev.detail;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const stars = (n) => '<span aria-hidden="true" style="color:#f59e0b; letter-spacing: 1px;">' + '★'.repeat(Math.round(n)) + '<span style="color:#cbd5e1">' + '★'.repeat(5 - Math.round(n)) + '</span></span>';
  async function loadList() {
    try {
      const r = await Pay.call('member?action=reviews&movie=' + encodeURIComponent(m.key));
      $('rv-avg').innerHTML = r.count ? stars(r.avg) + ' <b style="color: var(--beta-navy); font-size: 16px;">' + r.avg + '/5</b> · ' + r.count + ' đánh giá' : '';
      $('rv-list').innerHTML = r.count ? r.reviews.map((x) => '<div style="border-top: 1px solid #f1f5f9; padding: 12px 0;">'
        + '<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px;">' + stars(x.rating) + '<span class="sr-only">' + x.rating + ' sao</span> <b>' + esc(x.name) + '</b>'
        + '<span style="font-size: 11.5px; font-weight: 700; color: #15803d; background: #f0fdf4; border-radius: 99px; padding: 1px 8px;">Đã xem tại rạp</span>'
        + '<span style="color: #94a3b8; font-size: 12px;">' + new Date(x.created_at).toLocaleDateString('vi-VN') + '</span></div>'
        + (x.content ? '<p style="margin: 6px 0 0; font-size: 14px; color: #1e293b; line-height: 1.6;">' + esc(x.content).replace(/\n/g, '<br>') + '</p>' : '') + '</div>').join('')
        : '<p class="m" style="font-size: 14px;">Chưa có đánh giá. Khán giả đã xem phim tại rạp sẽ chấm điểm ở đây.</p>';
    } catch (e) { $('rv-list').innerHTML = '<p class="m">Không tải được đánh giá.</p>'; }
  }
  async function loadForm() {
    let token = null;
    try { token = localStorage.getItem('BETA_AUTH_TOKEN'); } catch (e) {}
    if (!token) { $('rv-form').innerHTML = '<p class="m" style="font-size: 13.5px; margin: 0 0 10px;">Đã xem phim tại Beta? <a href="' + esc(BetaAuth.loginUrl()) + '">Đăng nhập</a> để đánh giá.</p>'; return; }
    try {
      const r = await Pay.call('member?action=can_review&movie=' + encodeURIComponent(m.key));
      if (!r.orders.length) { $('rv-form').innerHTML = ''; return; }
      const o = r.orders[0];
      $('rv-form').innerHTML = '<form id="rv-f" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 12px;">'
        + '<div style="font-size: 13.5px; margin-bottom: 8px;">Bạn đã xem phim này (' + esc(o.show_time + ' ' + o.show_date + ' · ' + o.cinema) + '). Chấm điểm:</div>'
        + '<fieldset style="border: 0; padding: 0; margin: 0 0 8px; display: flex; gap: 4px;" aria-label="Số sao"><legend class="sr-only">Số sao</legend>'
        + [1, 2, 3, 4, 5].map((n) => '<label style="cursor: pointer; font-size: 26px; color: #cbd5e1;" data-n="' + n + '"><input type="radio" name="rating" value="' + n + '" required style="position: absolute; opacity: 0; width: 1px; height: 1px;"><span aria-hidden="true">★</span><span class="sr-only">' + n + ' sao</span></label>').join('')
        + '</fieldset><textarea name="content" maxlength="1000" rows="3" class="form-input" style="width: 100%; height: auto; padding: 10px;" placeholder="Cảm nhận của bạn (không bắt buộc, không tiết lộ nội dung phim)"></textarea>'
        + '<p id="rv-msg" role="status" style="font-size: 13px; margin: 6px 0;"></p><button class="btn btn-primary btn-sm" type="submit">Gửi đánh giá</button></form>';
      const f = $('rv-f');
      const paint = (v) => f.querySelectorAll('label[data-n]').forEach((l) => { l.style.color = Number(l.dataset.n) <= v ? '#f59e0b' : '#cbd5e1'; });
      f.querySelectorAll('input[name=rating]').forEach((i) => i.addEventListener('change', () => paint(Number(i.value))));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const rating = Number((f.querySelector('input[name=rating]:checked') || {}).value);
        try {
          await Pay.post('member?action=review', { order_code: o.order_code, rating, content: f.content.value });
          $('rv-form').innerHTML = '<p style="color: #15803d; font-weight: 700; font-size: 14px;">Cảm ơn bạn đã đánh giá!</p>';
          loadList();
        } catch (err) { $('rv-msg').textContent = err.message; $('rv-msg').style.color = '#b91c1c'; }
      };
    } catch (e) { $('rv-form').innerHTML = ''; }
  }
  loadList();
  loadForm();
});
