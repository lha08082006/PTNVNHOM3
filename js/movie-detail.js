// js/movie-detail.js - mã của movie-detail.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Chi tiết phim: phim, rạp, suất chiếu lấy từ /api/catalog. Bấm suất -> seats.html?showtime=<id>
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const params = new URLSearchParams(location.search);
  // Đường dẫn đẹp /phim/<mã-phim> (Đợt 3) hoặc kiểu cũ movie-detail.html?movie=<mã>
  let key = params.get('movie') || (location.pathname.match(/^\/phim\/([a-z0-9-]+)\/?$/) || [])[1] || '';
  let week = [];

  // SEO (Đợt 3): đường dẫn chuẩn, mô tả, ảnh chia sẻ, dữ liệu có cấu trúc schema.org (Movie + lịch chiếu)
  const setMeta = (sel, attr, val) => {
    let el = document.head.querySelector(sel);
    if (!el) { el = document.createElement(sel.startsWith('link') ? 'link' : 'meta'); const mm = /\[(\w+)="([^"]+)"\]/.exec(sel); el.setAttribute(mm[1], mm[2]); document.head.appendChild(el); }
    el.setAttribute(attr, val);
  };
  function seo(m) {
    const url = location.origin + '/phim/' + encodeURIComponent(m.key);
    if (location.protocol.startsWith('http') && !/^\/phim\//.test(location.pathname)) {
      try { history.replaceState(null, '', '/phim/' + encodeURIComponent(m.key) + location.hash); } catch (e) { /* bỏ qua */ }
    }
    const desc = (m.synopsis || m.meta || ('Lịch chiếu và đặt vé phim ' + m.title + ' tại Beta Cinemas.')).replace(/\s+/g, ' ').slice(0, 160);
    const img = m.poster ? new URL(m.poster, location.origin + '/').href : location.origin + '/images/logo-official.png';
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[name="description"]', 'content', desc);
    setMeta('meta[property="og:title"]', 'content', m.title + ' - Beta Cinemas');
    setMeta('meta[property="og:description"]', 'content', desc);
    setMeta('meta[property="og:image"]', 'content', img);
    setMeta('meta[property="og:url"]', 'content', url);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Movie', name: m.title, url, image: img, description: desc,
      ...(m.duration_min ? { duration: 'PT' + m.duration_min + 'M' } : {}),
      ...(m.genre ? { genre: String(m.genre).split(/,\s*/) } : {}),
      ...(m.director ? { director: { '@type': 'Person', name: m.director } } : {}),
      ...(m.cast ? { actor: String(m.cast).split(/,\s*/).slice(0, 6).map((n) => ({ '@type': 'Person', name: n })) } : {}),
      ...(m.release_date ? { datePublished: m.release_date } : {}),
      ...(m.age ? { contentRating: m.age } : {})
    };
    let s = document.getElementById('ld-movie');
    if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld-movie'; document.head.appendChild(s); }
    s.textContent = JSON.stringify(ld);
  }
  // Lịch chiếu dạng ScreeningEvent (Google có thể hiện giờ chiếu trong kết quả tìm kiếm)
  function seoShowtimes(m, list) {
    const ev = list.slice(0, 20).map((st) => ({
      '@context': 'https://schema.org', '@type': 'ScreeningEvent', name: m.title, startDate: st.starts_at,
      location: { '@type': 'MovieTheater', name: st.cinema }, workPresented: { '@type': 'Movie', name: m.title },
      videoFormat: st.format || '2D', inLanguage: 'vi',
      offers: { '@type': 'Offer', price: (st.prices && st.prices.standard) || 0, priceCurrency: 'VND', availability: st.seats_free > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut', url: location.origin + '/seats.html?showtime=' + st.id }
    }));
    let s = document.getElementById('ld-shows');
    if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld-shows'; document.head.appendChild(s); }
    s.textContent = JSON.stringify(ev);
  }
  // Có <base href="/">: liên kết "#mục" phải cuộn trong trang, không nhảy về trang chủ
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href').length < 2) return;
    const t = document.querySelector(a.getAttribute('href'));
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: 'smooth' });
    if (t.tabIndex < 0) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  });

  const renderMovie = (m) => {
    document.title = (m.shortTitle || m.title) + ' - Lịch chiếu & đặt vé | Beta Cinemas';
    $('md-title').textContent = m.title;
    $('md-sub').textContent = m.format || '';
    $('md-poster').src = m.poster || 'images/logo.png';
    $('md-poster').alt = 'Poster phim ' + (m.shortTitle || m.title);
    if (m.age) { $('md-age').hidden = false; $('md-age').textContent = m.age; }
    if (m.badge) { $('md-format').hidden = false; $('md-format').textContent = m.badge; }
    if (m.status === 'SOON') $('md-soon').hidden = false;
    document.dispatchEvent(new CustomEvent('md:movie', { detail: m }));
    seo(m);
    // Thông tin phim đầy đủ: thời lượng, khởi chiếu, ngôn ngữ, thể loại, đạo diễn, diễn viên, phân loại tuổi
    const fmtDate = (d) => d ? d.split('-').reverse().join('/') : '';
    const pills = [m.duration_min ? ['timer', m.duration_min + ' phút'] : null, m.release_date ? ['calendar', 'Khởi chiếu ' + fmtDate(m.release_date)] : null, m.language ? ['globe', m.language] : null].filter(Boolean);
    $('md-pills').innerHTML = pills.map(([ic, x]) => '<div class="stat-pill"><i class="ph-' + ic + '" aria-hidden="true"></i> ' + esc(x) + '</div>').join('');
    const rows = [['Thể loại', m.genre], ['Đạo diễn', m.director], ['Diễn viên', m.cast], ['Phân loại', m.age ? m.age + (m.age_note ? ' – ' + m.age_note : '') : '']].filter(([, v]) => v);
    $('md-meta').innerHTML = (m.synopsis ? '<span style="display:block;margin-bottom:10px;">' + esc(m.synopsis) + '</span>' : '') +
      rows.map(([k, v]) => '<span style="display:block;"><b>' + k + ':</b> ' + esc(v) + '</span>').join('');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = 'Xem lịch chiếu và đặt vé ' + (m.shortTitle || m.title) + ' tại Beta Cinemas. ' + (m.meta || '');
    Pay.catalog('posts', { movie: m.key, type: 'PROMO', limit: 3 }).then(r => {
      if (!r.posts.length) return;
      const box = document.createElement('div');
      box.style.cssText = 'margin-top: 14px; display: flex; flex-direction: column; gap: 6px;';
      box.innerHTML = '<b style="font-size: 13px; letter-spacing: .3px;"><i class="ph-tag" aria-hidden="true"></i> ƯU ĐÃI ĐANG ÁP DỤNG</b>' + r.posts.map(p =>
        '<a href="tin-tuc.html?id=' + encodeURIComponent(p.id) + '" style="color: #fde68a; font-weight: 700; font-size: 14px;">' + esc(p.title) + ' →</a>').join('');
      $('md-meta').after(box);
    }).catch(() => {});
    const trailer = m.trailer || (typeof MOVIE_TRAILERS !== 'undefined' && MOVIE_TRAILERS[m.key]);
    if (trailer) {
      if (typeof MOVIE_TRAILERS !== 'undefined') MOVIE_TRAILERS[m.key] = trailer;
      $('md-trailer-btn').hidden = false;
      $('md-trailer-btn').onclick = () => openTrailerModal(m.key, m.title);
    }
  };

  const renderSlots = () => {
    const cinema = $('md-cinema').value, date = $('md-date').value;
    const list = week.filter((s) => s.cinema_id === cinema && s.date === date);
    const cName = ($('md-cinema').selectedOptions[0] || {}).textContent || '';
    $('md-slots-title').innerHTML = '<i class=ph-map-pin aria-hidden=true></i> ' + esc(cName.toUpperCase());
    const min = list.reduce((a, s) => Math.min(a, (s.prices && s.prices.standard) || Infinity), Infinity);
    $('md-price-from').textContent = isFinite(min) ? 'Vé chỉ từ ' + Pay.vnd(min) : '';
    if (!list.length) { $('md-slots').innerHTML = '<p class="m">Rạp chưa có suất chiếu phim này trong ngày đã chọn. Hãy chọn ngày hoặc rạp khác.</p>'; return; }
    const byFormat = {};
    list.forEach((s) => (byFormat[s.format || ''] = byFormat[s.format || ''] || []).push(s));
    $('md-slots').innerHTML = Object.keys(byFormat).map((f) =>
      (f ? '<div class="md-group-title">' + esc(f) + '</div>' : '') +
      byFormat[f].map((s) => {
        const full = s.seats_free === 0;
        return '<a class="md-slot' + (full ? ' full' : '') + '" href="seats.html?showtime=' + encodeURIComponent(s.id) + '"' + (full ? ' aria-disabled="true" tabindex="-1"' : '') + '>' +
          '<b>' + esc(s.time) + (s.late ? ' <i class=ph-moon aria-hidden=true></i>' : '') + '</b>' + (s.end_time ? '<small>~ ' + esc(s.end_time) + ' kết thúc</small>' : '') +
          '<small>' + esc(s.room || '') + ' • ' + (full ? 'Hết ghế' : 'Còn ' + s.seats_free + ' ghế') + '</small></a>';
      }).join('')).join('') +
      '<p class="m" style="flex-basis: 100%; font-size: 12.5px; margin: 4px 0 0;">Giờ kết thúc là dự kiến; suất chiếu có thể bắt đầu muộn 10–15 phút do quảng cáo và giới thiệu phim.</p>';
  };

  const fillDates = () => {
    const cinema = $('md-cinema').value;
    const dates = [];
    week.forEach((s) => { if (s.cinema_id === cinema && !dates.some((d) => d.date === s.date)) dates.push({ date: s.date, label: s.date_label }); });
    dates.sort((a, b) => a.date.localeCompare(b.date));
    $('md-date').innerHTML = dates.length ? dates.map((d) => '<option value="' + esc(d.date) + '">' + esc(d.label) + '</option>').join('') : '<option value="">Chưa có lịch chiếu</option>';
    renderSlots();
  };

  try {
    const [mv, cn] = await Promise.all([Pay.catalog('movies'), Pay.catalog('cinemas')]);
    const movies = mv.movies || [];
    const m = movies.find((x) => x.key === key) || (!key && movies[0]);
    if (!m) {
      $('md-title').textContent = 'Không tìm thấy phim';
      $('md-slots').innerHTML = '<p class="m">Phim không tồn tại hoặc đã ngừng chiếu. <a href="schedule.html">Xem lịch chiếu các phim khác</a>.</p>';
      return;
    }
    key = m.key;
    renderMovie(m);
    const wk = await Pay.catalog('showtimes', { movie: key, days: 30 });
    week = wk.showtimes || [];
    seoShowtimes(m, week);
    const has = new Set(week.map((s) => s.cinema_id));
    const cinemas = (cn.cinemas || []).filter((c) => has.has(c.id));
    if (!cinemas.length) {
      $('md-cinema').innerHTML = '<option>Chưa có rạp chiếu</option>';
      $('md-date').innerHTML = '<option>—</option>';
      $('md-slots').innerHTML = '<p class="m">' + (m.status === 'SOON' ? 'Phim sắp khởi chiếu, lịch chiếu sẽ được cập nhật sớm.' : 'Phim chưa có suất chiếu trong 30 ngày tới.') + '</p><div id="md-watch" style="width: 100%;"></div>';
      document.dispatchEvent(new CustomEvent('md:noshow', { detail: m }));
      return;
    }
    $('md-cinema').innerHTML = cinemas.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name + (c.city ? ' (' + c.city + ')' : '')) + '</option>').join('');
    $('md-cinema').onchange = fillDates;
    $('md-date').onchange = renderSlots;
    fillDates();
  } catch (e) {
    if ($('md-title').textContent === 'Đang tải phim…') $('md-title').textContent = 'Không tải được thông tin phim';
    $('md-slots').innerHTML = '<p class="m">Không kết nối được máy chủ. <button type="button" class="btn btn-outline btn-sm" data-on-click="location.reload()">Thử lại</button></p>';
  }
})();
