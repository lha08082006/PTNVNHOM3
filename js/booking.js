// js/booking.js - mã của booking.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Đặt vé theo phim: chọn rạp + ngày -> suất chiếu thật (database) -> seats.html?showtime=<id>
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
const movieKey = params.get('movie') || '';
let cinemaId = params.get('cinema') || '';
let CINEMAS = [];
let today = '';
let selectedDate = '';
let selected = null;

const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cinemaName = () => (CINEMAS.find(c => c.id === cinemaId) || {}).name || '';

function renderMovie(m) {
  document.getElementById('detail-movie-title').textContent = m.title;
  document.getElementById('detail-movie-age').textContent = m.age;
  document.getElementById('detail-movie-meta').textContent = m.meta;
  document.getElementById('detail-movie-poster').src = m.poster;
  document.getElementById('summary-movie').textContent = m.shortTitle || m.title;
}

// Dải ngày gọn (Đợt 11): 7 ngày tới vừa một hàng, ngày rạp không có suất làm mờ; ngày xa hơn chọn ở ô "Ngày khác"
let WEEK = [];
const DAYS_SHOWN = 7;
function renderDates() {
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const box = document.getElementById('date-selector');
  box.innerHTML = '';
  const has = new Set(WEEK.filter(s => s.cinema_id === cinemaId).map(s => s.date));
  const label = (date) => { const [, mm, dd] = date.split('-'); return { dow: date === today ? 'Hôm nay' : DOW[new Date(date + 'T00:00:00Z').getUTCDay()], dm: dd + '/' + mm }; };
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const date = addDays(today, i);
    const l = label(date);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (date === selectedDate ? 'b' : 'o') + ' date-btn' + (has.has(date) ? '' : ' empty');
    btn.setAttribute('aria-pressed', String(date === selectedDate));
    if (!has.has(date)) btn.title = 'Chưa có suất chiếu';
    btn.innerHTML = `<span class="d1">${l.dow}</span><span class="d2">${l.dm}</span>`;
    btn.onclick = () => { selectedDate = date; renderDates(); loadShowtimes(); };
    box.appendChild(btn);
  }
  const last = addDays(today, DAYS_SHOWN - 1);
  const later = [...has].filter(d => d > last).sort();
  if (later.length) {
    const sel = document.createElement('select');
    sel.className = 'date-more' + (selectedDate > last ? ' on' : '');
    sel.setAttribute('aria-label', 'Chọn ngày khác');
    sel.innerHTML = (selectedDate > last ? '' : '<option value="">Ngày khác</option>') +
      later.map(d => { const l = label(d); return `<option value="${d}" ${d === selectedDate ? 'selected' : ''}>${l.dow} ${l.dm}</option>`; }).join('');
    sel.onchange = () => { if (!sel.value) return; selectedDate = sel.value; renderDates(); loadShowtimes(); };
    box.appendChild(sel);
  }
}

function updateSummary() {
  document.getElementById('summary-cinema').textContent = cinemaName();
  document.getElementById('cinema-name-tag').textContent = cinemaName();
  const btn = document.getElementById('btn-submit-seats');
  if (selected) {
    document.getElementById('summary-showtime').textContent = selected.date_label + ' · ' + selected.time;
    document.getElementById('summary-format').textContent = selected.format;
    document.getElementById('summary-available-count').textContent = selected.seats_free;
    btn.href = 'seats.html?showtime=' + encodeURIComponent(selected.id);
    btn.removeAttribute('aria-disabled');
    btn.classList.remove('b-wait');
    btn.textContent = 'Chọn ghế →';
    const step = document.getElementById('step-seats');
    if (step) { step.href = btn.href; step.removeAttribute('aria-disabled'); }
  } else {
    document.getElementById('summary-showtime').textContent = 'Chưa chọn suất';
    document.getElementById('summary-format').textContent = '—';
    document.getElementById('summary-available-count').textContent = '—';
    btn.removeAttribute('href');
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('b-wait');
    btn.textContent = 'Chọn suất chiếu trước';
    const step = document.getElementById('step-seats');
    if (step) { step.removeAttribute('href'); step.setAttribute('aria-disabled', 'true'); }
  }
}

async function loadShowtimes() {
  const box = document.getElementById('showtime-groups');
  box.innerHTML = '<p class="m">Đang tải suất chiếu...</p>';
  selected = null;
  updateSummary();
  try {
    const r = await Pay.catalog('showtimes', { movie: movieKey, cinema: cinemaId, date: selectedDate });
    if (!r.showtimes.length) { box.innerHTML = '<p class="m">Rạp chưa có suất chiếu phim này trong ngày đã chọn. Vui lòng chọn ngày hoặc rạp khác.</p>'; return; }
    const byFormat = {};
    r.showtimes.forEach(st => { (byFormat[st.format] = byFormat[st.format] || []).push(st); });
    box.innerHTML = Object.entries(byFormat).map(([fmt, list]) => `
          <div style="margin-top: 4px;">
            <p style="font-weight: 700; margin-bottom: 10px; font-size: 14.5px; color: var(--text-light);">${esc(fmt)}</p>
            <div class="g">${list.map(st => {
          const used = Math.round((1 - st.seats_free / st.seats_total) * 100);
          const low = st.seats_free > 0 && st.seats_free <= 12;
          return st.seats_free <= 0
            ? `<button class="sl" disabled><b>${st.time}</b><span class="bar"><i style="width: 100%; background: #64748b;"></i></span><span class="m" style="font-size: 12px; color: #ef4444;">Hết vé</span></button>`
            : `<button class="sl${low ? ' lo' : ''}" data-id="${esc(st.id)}" data-on-click="pickShowtime('${esc(st.id)}')">
                     <b>${st.time}</b><span class="bar"><i style="width: ${used}%;"></i></span>
                     <span class="m" style="font-size: 12px;${low ? ' color: var(--status-warning);' : ''}">${low ? 'Sắp hết · ' : ''}${st.seats_free}/${st.seats_total} ghế</span>
                     ${st.end_time ? `<span class="m" style="font-size: 11.5px;">~${st.end_time} kết thúc</span>` : ''}
                   </button>`;
        }).join('')}</div>
          </div>`).join('');
    window.__showtimes = r.showtimes;
  } catch (e) {
    box.innerHTML = `<p class="m" style="color: #dc2626;">Không tải được suất chiếu (${esc(e.message)}).</p>`;
  }
}

function pickShowtime(id) {
  selected = (window.__showtimes || []).find(s => s.id === id) || null;
  document.querySelectorAll('#showtime-groups .sl').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  updateSummary();
}

(async function init() {
  try {
    const [mv, cn, week] = await Promise.all([Pay.catalog('movies'), Pay.catalog('cinemas'), Pay.catalog('showtimes', { movie: movieKey, days: 30 })]);
    const m = mv.movies.find(x => x.key === movieKey);
    if (!m) { location.replace('home.html'); return; }
    renderMovie(m);
    WEEK = week.showtimes || [];
    // Chỉ liệt kê các rạp có chiếu phim này trong khoảng lịch đã mở bán
    const showing = new Set(week.showtimes.map(x => x.cinema_id));
    // Rạp yêu thích (đã lưu ở trang Lịch chiếu) lên đầu danh sách
    let fav = []; try { fav = JSON.parse(localStorage.getItem('BETA_FAV_CINEMAS') || '[]'); } catch (e) {}
    CINEMAS = cn.cinemas.filter(c => showing.has(c.id)).sort((a, b) => fav.includes(b.id) - fav.includes(a.id));
    if (!params.get('cinema') && CINEMAS[0] && fav.includes(CINEMAS[0].id)) cinemaId = CINEMAS[0].id;
    if (!CINEMAS.length) {
      document.getElementById('showtime-groups').innerHTML = '<p class="m">Phim chưa có lịch chiếu sắp tới. Lịch được mở bán dần, bạn quay lại sau nhé.</p>';
      updateSummary();
      return;
    }
    if (!CINEMAS.some(c => c.id === cinemaId)) cinemaId = CINEMAS[0] ? CINEMAS[0].id : '';
    const sel = document.getElementById('cinema-select');
    sel.innerHTML = CINEMAS.map(c => `<option value="${esc(c.id)}" ${c.id === cinemaId ? 'selected' : ''}>${esc(c.name)}${c.city ? ' (' + esc(c.city) + ')' : ''}</option>`).join('');
    sel.onchange = () => {
      cinemaId = sel.value;
      const f = week.showtimes.find(x => x.cinema_id === cinemaId);
      if (f) selectedDate = f.date;
      renderDates();
      loadShowtimes();
    };
    today = week.today;
    // Ngày mặc định: ngày gần nhất rạp đang chọn có suất
    const firstAtCinema = week.showtimes.find(x => x.cinema_id === cinemaId);
    selectedDate = firstAtCinema ? firstAtCinema.date : today;
    renderDates();
    await loadShowtimes();
  } catch (e) {
    document.getElementById('showtime-groups').innerHTML = `<p class="m" style="color: #dc2626;">Không tải được dữ liệu (${esc(e.message)}).</p>`;
  }
})();
