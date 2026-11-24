// js/home-catalog.js - mã của home.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Đồng bộ lưới phim với danh mục trong database: ẩn phim đã ẩn/không còn, thêm phim mới, gắn đúng tab
(async function syncMovieGrid() {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  try {
    const { movies } = await Pay.catalog('movies');
    const byKey = Object.fromEntries(movies.map(m => [m.key, m]));
    const grid = document.getElementById('movie-grid');
    // Giữ lại từ HTML tĩnh: phim nào thuộc "Suất chiếu đặc biệt" và link trailer dự phòng
    const special = new Set(), staticTrailer = {};
    grid.querySelectorAll('.movie-card').forEach(card => {
      const a = card.querySelector('a[href*="booking.html?movie="]');
      const key = a ? new URL(a.href).searchParams.get('movie') : null;
      if (!key) return;
      if ((card.getAttribute('data-tab') || '').includes('special')) special.add(key);
      const tb = card.querySelector('[data-trailer]');
      if (tb && tb.getAttribute('data-trailer')) staticTrailer[key] = tb.getAttribute('data-trailer');
    });
    // Đợt 10: mọi thông tin trên thẻ lấy từ database – Quản lý sửa tên, poster, nhãn tuổi, thể loại, trailer,
    // trạng thái (đang chiếu / sắp chiếu) trong admin là trang chủ đổi theo
    const AGE_CLS = (a) => /18/.test(a) ? 'badge-age-18' : /16/.test(a) ? 'badge-age-16' : /13/.test(a) ? 'badge-age-13' : 'badge-age-p';
    const dmy = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
    const cardHtml = (m) => {
      const soon = m.status === 'SOON';
      const link = 'booking.html?movie=' + encodeURIComponent(m.key);
      const detail = 'phim/' + encodeURIComponent(m.key);
      const trailer = m.trailer || staticTrailer[m.key] || (typeof MOVIE_TRAILERS === 'object' && MOVIE_TRAILERS[m.key]) || '';
      const genre = m.genre || String(m.meta || '').split('·')[0].trim();
      return `<div class="movie-card" data-key="${esc(m.key)}" data-genre="${esc(genre)}" data-tab="${soon ? 'soon' : 'now'}${special.has(m.key) ? ' special' : ''}">
            <div class="movie-poster-wrap">
              <img loading="lazy" class="movie-poster-img" src="${esc(m.poster)}" alt="${esc(m.title)}" data-fallback="images/400x633-145627-230926-40.jpg">
              ${m.age ? `<div class="movie-age-tag"><span class="badge ${AGE_CLS(m.age)}">${esc(m.age)}</span></div>` : ''}
              <div class="movie-poster-overlay">
                <a href="${link}" class="btn-overlay-buy"><i class="ph-ticket" aria-hidden="true"></i> ${soon ? 'ĐẶT TRƯỚC' : 'MUA VÉ'}</a>
                ${trailer ? `<button type="button" class="btn-overlay-trailer" data-trailer="${esc(trailer)}"><i class="ph-play" aria-hidden="true"></i> XEM TRAILER</button>` : ''}
              </div>
            </div>
            <div class="movie-info-official">
              <h3 class="movie-title-official"><a href="${detail}">${esc(m.title)}</a></h3>
              <div class="movie-meta-official">
                ${soon && m.release_date ? `<span><strong>Khởi chiếu:</strong> ${dmy(m.release_date)}</span>` : ''}
                ${genre ? `<span><strong>Thể loại:</strong> ${esc(genre)}</span>` : ''}
                ${m.duration_min ? `<span><strong>Thời lượng:</strong> ${m.duration_min} phút</span>` : ''}
              </div>
              <div class="movie-actions">
                <a class="ma-buy" href="${link}"><i class="ph-ticket" aria-hidden="true"></i> ${soon ? 'Đặt trước' : 'Mua vé'}</a>
                ${trailer ? `<button type="button" class="ma-trailer" aria-label="Xem trailer ${esc(m.title)}"><i class="ph-play" aria-hidden="true"></i><span>Trailer</span></button>` : ''}
              </div>
            </div>
          </div>`;
    };
    grid.innerHTML = movies.map(cardHtml).join('');
    grid.querySelectorAll('.movie-card').forEach(card => {
      const m = byKey[card.dataset.key];
      const tr = card.querySelector('.btn-overlay-trailer');
      if (!tr) return;
      tr.onclick = () => openTrailerModal(m.key, m.title, tr);
      const small = card.querySelector('.ma-trailer');
      if (small) small.onclick = () => tr.click();
    });
    Pay.catalog('banners').then(r => window.applyBanners && window.applyBanners(r.banners)).catch(() => { /* giữ banner mặc định */ });
    window.__movies = movies;
    window.dispatchEvent(new Event('beta:movies'));
    // Đợt 9: điểm khán giả ★ (đủ lượt đánh giá) + thứ hạng bán chạy 7 ngày
    Pay.catalog('movie_stats').then(({ stats }) => {
      grid.querySelectorAll('.movie-card').forEach(card => {
        const s = stats && stats[card.dataset.key];
        const wrap = card.querySelector('.movie-poster-wrap');
        if (!s || !wrap) return;
        if (s.avg != null && !wrap.querySelector('.movie-rating')) wrap.insertAdjacentHTML('beforeend', `<span class="movie-rating" aria-label="Khán giả chấm ${s.avg} trên 5 sao, ${s.count} lượt"><i class="ph-star" aria-hidden="true"></i>${s.avg.toFixed(1)}<small>(${s.count})</small></span>`);
        if (s.rank && s.rank <= 3 && !wrap.querySelector('.movie-rank')) wrap.insertAdjacentHTML('beforeend', `<span class="movie-rank" title="Top ${s.rank} bán chạy 7 ngày qua" aria-label="Top ${s.rank} bán chạy tuần này">${s.rank}</span>`);
      });
    }).catch(() => { /* không có điểm: thẻ phim vẫn đủ thông tin */ });
    // Khối TIN MỚI & ƯU ĐÃI: 3 bài đang hiển thị (ghim lên đầu) – Quản lý đăng trong admin
    try {
      const pr = await Pay.catalog('posts', { limit: 3 });
      const box = document.querySelector('#promos .grid-3');
      if (box) box.innerHTML = pr.posts.length ? pr.posts.map(p => `
            <a class="card" href="tin-tuc.html?id=${encodeURIComponent(p.id)}" style="border-radius: 12px; text-decoration: none; color: inherit; display: block;">
              <img loading="lazy" src="${esc(p.image || 'images/logo-official.png')}" alt="" style="width: 100%; height: 210px; object-fit: cover;" data-fallback="images/logo-official.png">
              <div style="padding: 18px;">
                <h3 style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 800; color: #005198; margin: 0 0 6px; text-transform: uppercase;">${esc(p.title)}</h3>
                <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0;">${esc(p.summary)}</p>
              </div>
            </a>`).join('') : '<p class="m" style="grid-column: 1 / -1; text-align: center;">Hiện chưa có ưu đãi nào.</p>';
    } catch (e) { /* giữ thông báo đang tải */ }

    // Nút lọc thể loại: gom từ thể loại của các phim đang có
    const genres = [...new Set(movies.flatMap(m => String(m.genre || '').split(',').map(x => x.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'vi'));
    const chips = document.getElementById('genre-chips');
    const drawChips = () => {
      chips.innerHTML = ['', ...genres].map(g => `<button type="button" class="chip" aria-pressed="${(window.__genre || '') === g}" data-genre="${esc(g)}">${g ? esc(g) : 'Tất cả'}</button>`).join('');
      chips.querySelectorAll('button').forEach(b => b.onclick = () => {
        window.__genre = b.dataset.genre;
        drawChips();
        const act = document.querySelector('.movie-tab-btn.active');
        switchMovieTab(act ? act.id.replace('tab-', '') : 'now');
      });
    };
    if (genres.length > 1) drawChips();
    const active = document.querySelector('.movie-tab-btn.active');
    if (typeof switchMovieTab === 'function') switchMovieTab(active ? active.id.replace('tab-', '') : 'now');
  } catch (e) {
    console.warn('Không đồng bộ được danh sách phim:', e.message);
  } finally {
    document.getElementById('movie-grid').classList.remove('syncing');
  }
})();
// Đợt 9: Mua vé nhanh – chọn lần lượt phim, rạp, ngày, suất rồi vào thẳng trang chọn ghế
(function quickBuy() {
  const $ = (id) => document.getElementById(id);
  const mSel = $('qb-movie'), cSel = $('qb-cinema'), dSel = $('qb-date'), tSel = $('qb-time'), go = $('qb-go');
  if (!mSel) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const opt = (v, t, dis) => `<option value="${esc(v)}"${dis ? ' disabled' : ''}>${esc(t)}</option>`;
  const reset = (sel, text) => { sel.innerHTML = opt('', text); sel.disabled = true; };
  let sts = [], today = '';
  const fill = (movies) => {
    const now = movies.filter(m => m.status !== 'SOON');
    mSel.innerHTML = opt('', now.length ? 'Chọn phim' : 'Chưa có phim đang chiếu') + now.map(m => opt(m.key, m.title)).join('');
  };
  if (window.__movies) fill(window.__movies); else window.addEventListener('beta:movies', () => fill(window.__movies), { once: true });
  mSel.onchange = async () => {
    reset(dSel, 'Chọn rạp trước'); reset(tSel, 'Chọn ngày trước'); go.disabled = true;
    if (!mSel.value) { reset(cSel, 'Chọn phim trước'); return; }
    reset(cSel, 'Đang tải suất chiếu…');
    try {
      const r = await Pay.catalog('showtimes', { movie: mSel.value, days: 7 });
      sts = r.showtimes || []; today = r.today || '';
    } catch (e) { reset(cSel, 'Không tải được suất chiếu'); return; }
    const cins = [...new Map(sts.map(s => [s.cinema_id, s.cinema])).entries()];
    if (!cins.length) { reset(cSel, 'Phim chưa có suất chiếu'); return; }
    cSel.innerHTML = opt('', 'Chọn rạp') + cins.map(([id, n]) => opt(id, n)).join('');
    cSel.disabled = false;
    let saved = null; try { saved = localStorage.getItem('BETA_CINEMA'); } catch (e) { /* bỏ qua */ }
    if (cins.some(([id]) => id === saved)) { cSel.value = saved; cSel.onchange(); }
  };
  cSel.onchange = () => {
    reset(tSel, 'Chọn ngày trước'); go.disabled = true;
    const days = [...new Map(sts.filter(s => s.cinema_id === cSel.value).map(s => [s.date, s.date_label])).entries()];
    if (!cSel.value || !days.length) { reset(dSel, 'Chọn rạp trước'); return; }
    dSel.innerHTML = days.map(([d, l]) => opt(d, (d === today ? 'Hôm nay · ' : '') + l)).join('');
    dSel.disabled = false;
    dSel.onchange();
  };
  dSel.onchange = () => {
    const list = sts.filter(s => s.cinema_id === cSel.value && s.date === dSel.value);
    tSel.innerHTML = opt('', 'Chọn suất') + list.map(s => opt(s.id, s.time + ' · ' + s.format + (s.seats_free ? ' · còn ' + s.seats_free + ' ghế' : ' · hết vé'), !s.seats_free)).join('');
    tSel.disabled = false; go.disabled = true;
  };
  tSel.onchange = () => { go.disabled = !tSel.value; };
  go.onclick = () => {
    if (!tSel.value) return;
    if (window.BetaRememberCinema) window.BetaRememberCinema(cSel.value);
    location.href = 'seats.html?showtime=' + encodeURIComponent(tSel.value);
  };
})();
// Mạng chậm / lỗi: không giữ ẩn quá 4 giây
setTimeout(() => { const g = document.getElementById('movie-grid'); if (g) g.classList.remove('syncing'); }, 4000);
