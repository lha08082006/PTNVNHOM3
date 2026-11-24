// js/rap.js - mã của rap.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Trang Rạp (Đợt 9): danh sách theo tỉnh / thành, rạp gần tôi; trang chi tiết có hotline, chỉ đường,
// giới thiệu, tiện ích, phòng chiếu, giá tham khảo và suất chiếu 7 ngày.
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const favs = () => store.get('BETA_FAV_CINEMAS') || [];
  const mapUrl = (c) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.lat != null && c.lng != null ? c.lat + ',' + c.lng : [c.name, c.address, c.city].filter(Boolean).join(', '));
  const tel = (p) => 'tel:' + String(p).replace(/[^0-9+]/g, '');
  const photo = (c, cls) => c.image ? `<img src="${esc(c.image)}" alt="Rạp ${esc(c.name)}" loading="lazy" data-fallback="images/logo-white-official.png" data-fallback-class="logo">` : `<img class="logo" src="images/logo-white-official.png" alt="">`;
  const id = new URLSearchParams(location.search).get('id');

  let cinemas = [];
  try { cinemas = (await Pay.catalog('cinemas')).cinemas || []; }
  catch (e) { $('rap-count').textContent = 'Không tải được danh sách rạp. Vui lòng thử lại sau.'; return; }

  if (id) return detail(id);
  list();

  // ---------------------------------------------------------------------
  function list() {
    let city = '', dist = null;
    const cities = [...new Set(cinemas.map(c => c.city || 'Khác'))].sort((a, b) => a.localeCompare(b, 'vi'));
    $('rap-count').textContent = cinemas.length + ' rạp tại ' + cities.length + ' tỉnh / thành phố. Chọn rạp để xem địa chỉ, chỉ đường và suất chiếu.';
    const chips = () => {
      $('rap-cities').innerHTML = ['', ...cities].map(c => `<button type="button" class="chip" aria-pressed="${city === c}" data-c="${esc(c)}">${c ? esc(c) : 'Tất cả'}</button>`).join('');
      $('rap-cities').querySelectorAll('button').forEach(b => b.onclick = () => { city = b.dataset.c; chips(); draw(); });
    };
    const card = (c) => `
          <article class="rap-card">
            <a class="ph" href="rap.html?id=${encodeURIComponent(c.id)}" tabindex="-1" aria-hidden="true">${photo(c)}</a>
            <div class="bd">
              ${c.city ? `<span class="rap-city">${esc(c.city)}</span>` : ''}
              <h2><a href="rap.html?id=${encodeURIComponent(c.id)}">${esc(c.name)}</a></h2>
              ${dist && dist[c.id] != null ? `<span class="rap-dist">Cách bạn ~${dist[c.id].toFixed(1)} km</span>` : ''}
              <p class="rap-line"><i class="ph-map-pin" aria-hidden="true"></i><span>${c.address ? esc(c.address) + (c.city ? ', ' + esc(c.city) : '') : `<span class="muted">Địa chỉ đang cập nhật</span>`}</span></p>
              ${c.phone ? `<p class="rap-line"><i class="ph-phone" aria-hidden="true"></i><a href="${tel(c.phone)}">${esc(c.phone)}</a></p>` : ''}
              <div class="rap-acts">
                <a class="btn-pri" href="schedule.html?cinema=${encodeURIComponent(c.id)}"><i class="ph-calendar" aria-hidden="true"></i> Lịch chiếu</a>
                <a class="btn-out" href="rap.html?id=${encodeURIComponent(c.id)}">Chi tiết</a>
                <a class="btn-out" href="${esc(mapUrl(c))}" target="_blank" rel="noopener" aria-label="Chỉ đường tới ${esc(c.name)} (mở Google Maps)"><i class="ph-map-pin" aria-hidden="true"></i></a>
              </div>
            </div>
          </article>`;
    const draw = () => {
      let rows = cinemas.filter(c => !city || (c.city || 'Khác') === city);
      if (dist || city || cinemas.length <= 12) {
        if (dist) rows = rows.slice().sort((a, b) => (dist[a.id] ?? 1e9) - (dist[b.id] ?? 1e9));
        else rows = rows.slice().sort((a, b) => (a.city || '').localeCompare(b.city || '', 'vi') || a.name.localeCompare(b.name, 'vi'));
        $('rap-grid').innerHTML = `<div class="rap-grid">${rows.map(card).join('')}</div>`;
        return;
      }
      const groups = {};
      rows.forEach(c => (groups[c.city || 'Khác'] = groups[c.city || 'Khác'] || []).push(c));
      $('rap-grid').innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'vi')).map(g =>
        `<h2 class="rap-group">${esc(g)} <small style="color:#64748b; font-weight:700;">(${groups[g].length})</small></h2><div class="rap-grid">${groups[g].map(card).join('')}</div>`).join('');
    };
    // Vị trí chỉ dùng trên máy để tính khoảng cách, không gửi lên máy chủ
    $('rap-near').onclick = () => {
      const msg = $('rap-msg');
      if (!navigator.geolocation) { msg.textContent = 'Trình duyệt không hỗ trợ định vị.'; return; }
      msg.textContent = 'Đang lấy vị trí của bạn…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        const km = (c) => { const R = 6371, r = Math.PI / 180, dLa = (c.lat - la) * r, dLo = (c.lng - lo) * r; const a = Math.sin(dLa / 2) ** 2 + Math.cos(la * r) * Math.cos(c.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
        dist = Object.fromEntries(cinemas.filter(c => c.lat != null && c.lng != null).map(c => [c.id, km(c)]));
        if (!Object.keys(dist).length) { dist = null; msg.textContent = 'Các rạp chưa có tọa độ để so sánh khoảng cách.'; return; }
        city = ''; chips(); draw();
        const near = cinemas.filter(c => dist[c.id] != null).sort((a, b) => dist[a.id] - dist[b.id])[0];
        msg.textContent = 'Đã sắp xếp theo khoảng cách. Gần nhất: ' + near.name + ' (~' + dist[near.id].toFixed(1) + ' km).';
      }, (e) => { msg.textContent = e.code === 1 ? 'Bạn chưa cho phép truy cập vị trí.' : 'Không lấy được vị trí, vui lòng chọn rạp theo thành phố.'; }, { timeout: 10000, maximumAge: 600000 });
    };
    chips(); draw();
    // Dữ liệu có cấu trúc: danh sách rạp chiếu phim
    addLd({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Hệ thống rạp Beta Cinemas',
      itemListElement: cinemas.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: location.origin + '/rap.html?id=' + encodeURIComponent(c.id), name: c.name })) });
  }

  // ---------------------------------------------------------------------
  async function detail(cid) {
    $('rap-list-view').hidden = true;
    $('rap-detail-view').hidden = false;
    let c = cinemas.find(x => x.id === cid), rooms = [];
    try { const r = await Pay.catalog('cinema', { id: cid }); c = r.cinema; rooms = r.rooms || []; } catch (e) { /* dùng dữ liệu danh sách */ }
    if (!c) {
      $('rap-detail-view').innerHTML = '<div class="rd-card"><h1 style="font-size:22px">Không tìm thấy rạp</h1><p>Rạp này không tồn tại hoặc đã tạm đóng.</p><a class="btn-pri" href="rap.html" style="display:inline-flex">Xem danh sách rạp</a></div>';
      return;
    }
    if (window.BetaRememberCinema) window.BetaRememberCinema(c.id);
    document.title = c.name + ' - Địa chỉ, hotline, lịch chiếu | Beta Cinemas';
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', ('Rạp ' + c.name + (c.address ? ', ' + c.address : '') + (c.city ? ', ' + c.city : '') + ': lịch chiếu hôm nay, giá vé, hotline và chỉ đường.').slice(0, 160));
    $('rd-crumb').textContent = c.name;
    $('rd-name').textContent = c.name;
    $('rd-img').innerHTML = photo(c);
    $('rd-address').innerHTML = c.address ? esc(c.address) + (c.city ? ', ' + esc(c.city) : '') : '<span class="muted">Địa chỉ đang cập nhật</span>' + (c.city ? ' · ' + esc(c.city) : '');
    $('rd-phone').innerHTML = c.phone ? `<a href="${tel(c.phone)}">${esc(c.phone)}</a>` : '<a href="support.html">Trung tâm hỗ trợ</a>';
    $('rd-schedule').href = 'schedule.html?cinema=' + encodeURIComponent(c.id);
    $('rd-map').href = mapUrl(c);
    $('rd-map').setAttribute('aria-label', 'Chỉ đường tới ' + c.name + ' (mở Google Maps)');
    const fav = () => {
      const on = favs().includes(c.id);
      $('rd-fav').textContent = on ? '★ Rạp yêu thích' : '☆ Lưu rạp yêu thích';
      $('rd-fav').setAttribute('aria-pressed', String(on));
    };
    $('rd-fav').onclick = () => { const f = favs(); store.set('BETA_FAV_CINEMAS', f.includes(c.id) ? f.filter(x => x !== c.id) : [c.id, ...f].slice(0, 5)); fav(); };
    fav();
    $('rd-intro').innerHTML = c.intro ? esc(c.intro).replace(/\n/g, '<br>') : `${esc(c.name)} thuộc hệ thống Beta Cinemas. Đặt vé online, thanh toán VietQR và nhận vé điện tử trong vài giây; đến rạp chỉ cần đưa mã QR cho nhân viên soát vé.`;
    $('rd-amen').innerHTML = (c.amenities || []).map(a => `<span>${esc(a)}</span>`).join('');
    if (rooms.length) {
      $('rd-rooms-card').hidden = false;
      $('rd-rooms').innerHTML = rooms.map(r => `<li><b>${esc(r.name)}</b><span>${esc(r.kind || '2D')} · ${r.seats} ghế</span></li>`).join('');
    }
    addLd({ '@context': 'https://schema.org', '@type': 'MovieTheater', name: c.name, url: location.href,
      ...(c.phone ? { telephone: c.phone } : {}), ...(c.image ? { image: new URL(c.image, location.href).href } : {}),
      address: { '@type': 'PostalAddress', streetAddress: c.address || undefined, addressLocality: c.city || undefined, addressCountry: 'VN' },
      ...(c.lat != null && c.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lng } } : {}) });

    // Suất chiếu 7 ngày
    let sts = [], today = '', loadErr = false;
    try { const r = await Pay.catalog('showtimes', { cinema: c.id, days: 7 }); sts = r.showtimes || []; today = r.today || ''; }
    catch (e) { loadErr = true; $('rd-shows').innerHTML = '<p class="muted">Không tải được suất chiếu. Vui lòng thử lại.</p>'; }
    // Giá tham khảo: giá thấp nhất từng loại ghế trong các suất sắp tới (đã áp quy tắc ngày / khung giờ)
    const min = (t) => { const v = sts.map(s => s.prices && s.prices[t]).filter(Boolean); return v.length ? Math.min(...v) : null; };
    const rowsP = [['Ghế thường', min('standard')], ['Ghế VIP', min('vip')], ['Ghế đôi (2 người)', min('sweetbox')]].filter(([, v]) => v);
    $('rd-prices').innerHTML = '<tbody>' + (rowsP.length ? rowsP.map(([k, v]) => `<tr><td>${k}</td><td>từ ${Pay.vnd(v)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">Chưa có suất chiếu để tính giá.</td></tr>') + '</tbody>';
    const days = [...new Map(sts.map(s => [s.date, s.date_label])).entries()];
    let day = days.length ? days[0][0] : '';
    const drawDays = () => {
      $('rd-days').innerHTML = days.map(([d, l]) => `<button type="button" class="chip" aria-pressed="${d === day}" data-d="${d}">${d === today ? 'Hôm nay' : esc(l)}</button>`).join('');
      $('rd-days').querySelectorAll('button').forEach(b => b.onclick = () => { day = b.dataset.d; drawDays(); drawShows(); });
    };
    const drawShows = () => {
      const list = sts.filter(s => s.date === day);
      if (!list.length) { $('rd-shows').innerHTML = '<p class="muted">Rạp chưa có suất chiếu trong 7 ngày tới.</p>'; return; }
      const byMovie = {};
      list.forEach(s => (byMovie[s.movie_key] = byMovie[s.movie_key] || []).push(s));
      $('rd-shows').innerHTML = Object.values(byMovie).map(arr => {
        const m = arr[0].movie || { key: arr[0].movie_key, title: arr[0].movie_key };
        return `<div class="rd-movie">
              <a href="phim/${encodeURIComponent(m.key)}" tabindex="-1" aria-hidden="true"><img src="${esc(m.poster)}" alt="" loading="lazy" data-fallback="hide"></a>
              <div><h3><a href="phim/${encodeURIComponent(m.key)}">${esc(m.title)}</a></h3>
                <small>${esc([m.age, m.duration_min ? m.duration_min + ' phút' : '', arr[0].format].filter(Boolean).join(' · '))}</small>
                <div class="rd-times">${arr.map(s => s.seats_free > 0
              ? `<a href="seats.html?showtime=${encodeURIComponent(s.id)}" title="${esc(s.time + (s.end_time ? ' – kết thúc khoảng ' + s.end_time : '') + ' · còn ' + s.seats_free + ' ghế')}">${s.time}</a>`
              : `<span title="Hết vé">${s.time}</span>`).join('')}</div>
              </div></div>`;
      }).join('');
    };
    if (days.length) { drawDays(); drawShows(); } else if (!loadErr) $('rd-shows').innerHTML = '<p class="muted">Rạp chưa có suất chiếu trong 7 ngày tới.</p>';
  }

  function addLd(obj) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(obj).replace(/</g, '\\u003c');
    document.head.appendChild(s);
  }
})();
