// js/schedule.js - mã của schedule.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Lịch chiếu thật từ database: chọn rạp + ngày -> danh sách phim và suất (kèm ghế trống)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
let currentCinema = params.get('cinema') || (() => { try { return localStorage.getItem('BETA_CINEMA') || ''; } catch (e) { return ''; } })();
let currentDate = '';
let today = '';
const DAYS = 14;          // lịch mở bán 14 ngày (cron tự gia hạn mỗi ngày) – dải ngày khớp dữ liệu thật
let CINEMAS = [];
let fmtFilter = '';        // lọc định dạng (2D, 3D, phụ đề, lồng tiếng…)
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const favs = () => store.get('BETA_FAV_CINEMAS') || [];

// Rạp yêu thích lên đầu danh sách, có dấu ★
function renderCinemaSelect() {
  const sel = document.getElementById('schedule-cinema-select');
  const f = favs();
  const sorted = [...CINEMAS].sort((a, b) => (f.includes(b.id) - f.includes(a.id)));
  sel.innerHTML = sorted.map(x => `<option value="${esc(x.id)}" ${x.id === currentCinema ? 'selected' : ''}>${f.includes(x.id) ? '★ ' : ''}${esc(x.name)}${x.city ? ' (' + esc(x.city) + ')' : ''}</option>`).join('');
  const on = f.includes(currentCinema);
  const b = document.getElementById('btn-fav');
  b.textContent = on ? '★ Rạp yêu thích' : '☆ Lưu rạp yêu thích';
  b.setAttribute('aria-pressed', String(on));
}
function toggleFavorite() {
  const f = favs();
  store.set('BETA_FAV_CINEMAS', f.includes(currentCinema) ? f.filter(x => x !== currentCinema) : [currentCinema, ...f].slice(0, 5));
  renderCinemaSelect();
}
// Gợi ý rạp gần nhất theo vị trí (chỉ dùng trên máy, không gửi vị trí lên máy chủ)
function findNearest() {
  const msg = document.getElementById('near-msg');
  if (!navigator.geolocation) { msg.textContent = 'Trình duyệt không hỗ trợ định vị.'; return; }
  msg.textContent = 'Đang lấy vị trí…';
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: la, longitude: lo } = pos.coords;
    const km = (c) => { const R = 6371, r = Math.PI / 180, dLa = (c.lat - la) * r, dLo = (c.lng - lo) * r; const a = Math.sin(dLa / 2) ** 2 + Math.cos(la * r) * Math.cos(c.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
    const near = CINEMAS.filter(c => c.lat != null && c.lng != null).map(c => ({ c, d: km(c) })).sort((a, b) => a.d - b.d);
    if (!near.length) { msg.textContent = 'Chưa có tọa độ rạp để so sánh.'; return; }
    msg.textContent = 'Gần nhất: ' + near[0].c.name + ' (~' + near[0].d.toFixed(1) + ' km)';
    changeCinema(near[0].c.id);
    renderCinemaSelect();
  }, (e) => { msg.textContent = e.code === 1 ? 'Bạn chưa cho phép truy cập vị trí.' : 'Không lấy được vị trí, vui lòng chọn rạp thủ công.'; }, { timeout: 10000, maximumAge: 600000 });
}
function setFormat(f) { fmtFilter = f; loadShowtimes(); }

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function renderDateBar() {
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const bar = document.getElementById('official-date-bar');
  bar.innerHTML = '';
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(today, i);
    const [, m, d] = date.split('-');
    const dow = DOW[new Date(date + 'T00:00:00Z').getUTCDay()];
    const item = document.createElement('div');
    item.className = 'date-item-official' + (date === currentDate ? ' active' : '');
    item.onclick = () => { currentDate = date; renderDateBar(); loadShowtimes(); };
    item.innerHTML = `<span class="d-number">${d}</span><span class="d-sub">/${m} - ${i === 0 ? 'Hôm nay' : dow}</span>`;
    bar.appendChild(item);
  }
  const act = bar.querySelector('.active');
  if (act) bar.scrollLeft = Math.max(0, act.offsetLeft - bar.offsetLeft - 60);
  updateDateNav();
}
function updateDateNav() {
  const bar = document.getElementById('official-date-bar');
  const max = bar.scrollWidth - bar.clientWidth;
  document.querySelector('.dbar-nav.prev').classList.toggle('show', bar.scrollLeft > 4);
  document.querySelector('.dbar-nav.next').classList.toggle('show', bar.scrollLeft < max - 4);
}
function scrollDates(dir) {
  const bar = document.getElementById('official-date-bar');
  bar.scrollBy({ left: dir * Math.max(200, bar.clientWidth * 0.7), behavior: 'smooth' });
}
document.getElementById('official-date-bar').addEventListener('scroll', () => updateDateNav(), { passive: true });
window.addEventListener('resize', () => updateDateNav());

function changeCinema(id) {
  currentCinema = id;
  if (window.BetaRememberCinema) window.BetaRememberCinema(id);
  const u = new URL(location.href);
  u.searchParams.set('cinema', id);
  history.replaceState(null, '', u);
  if (CINEMAS.length) renderCinemaSelect();
  loadShowtimes();
}

async function loadShowtimes() {
  const list = document.getElementById('sch-list');
  list.innerHTML = '<p style="padding: 30px 0; text-align: center; color: #64748b;">Đang tải lịch chiếu...</p>';
  try {
    const r = await Pay.catalog('showtimes', { cinema: currentCinema, date: currentDate });
    const formats = [...new Set(r.showtimes.map(s => s.format))].sort();
    if (fmtFilter && !formats.includes(fmtFilter)) fmtFilter = '';
    document.getElementById('fmt-chips').innerHTML = formats.length > 1 ? ['', ...formats].map(f =>
      `<button type="button" class="btn btn-sm ${fmtFilter === f ? 'btn-primary' : 'btn-outline'}" aria-pressed="${fmtFilter === f}" data-on-click="setFormat('${esc(f)}')">${f ? esc(f) : 'Tất cả định dạng'}</button>`).join('') : '';
    const byMovie = {};
    r.showtimes.filter(st => !fmtFilter || st.format === fmtFilter).forEach(st => { (byMovie[st.movie_key] = byMovie[st.movie_key] || []).push(st); });
    const keys = Object.keys(byMovie);
    if (!keys.length) {
      list.innerHTML = '<p style="padding: 40px 0; text-align: center; color: #64748b;">Rạp chưa có suất chiếu nào trong ngày này. Vui lòng chọn ngày khác.</p>';
      return;
    }
    list.innerHTML = keys.map((k, i) => {
      const sts = byMovie[k];
      const m = sts[0].movie;
      const byFormat = {};
      sts.forEach(st => { (byFormat[st.format] = byFormat[st.format] || []).push(st); });
      return `<div class="sch-movie-row">
            <a class="sch-poster-box" href="phim/${encodeURIComponent(k)}">
              ${m.age ? `<span class="age-badge-corner">${esc(m.age)}</span>` : ''}
              <img ${i < 2 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" src="${esc(m.poster)}" alt="${esc(m.title)}" data-fallback="images/400x633-145627-230926-40.jpg">
            </a>
            <div class="sch-movie-details">
              <h2 class="sch-movie-title">${esc(m.shortTitle || m.title)}</h2>
              <div class="sch-movie-meta-tags">
                ${m.meta ? `<span><span style="color: #03599d;"><i class=ph-tag aria-hidden=true></i></span> ${esc(m.meta.split('·')[0].trim())}</span>` : ''}
                ${m.duration_min ? `<span><span style="color: #03599d;"><i class=ph-timer aria-hidden=true></i></span> ${m.duration_min} phút</span>` : ''}
              </div>
              ${Object.entries(byFormat).map(([fmt, list]) => `
                <div class="sch-format-title">${esc(fmt)}${(() => { const p = list.map(s => s.prices && s.prices.standard).filter(Boolean); return p.length ? `<span class="from">· vé từ ${Pay.vnd(Math.min(...p))}</span>` : ''; })()}</div>
                <div class="sch-slots-grid">
                  ${list.map(st => st.seats_free > 0 ? `
                    <a href="seats.html?showtime=${encodeURIComponent(st.id)}" class="sch-slot-card${st.late ? ' late' : ''}" title="${esc(st.time + (st.end_time ? ' – kết thúc khoảng ' + st.end_time : '') + ' · ' + st.room + ' · vé từ ' + Pay.vnd(st.prices.standard))}">
                      <span class="sch-slot-time">${st.time}</span>
                      ${st.late ? `<span class="sch-slot-date">${esc(st.date_label.split(' ')[1])}</span>` : ''}
                      ${st.end_time ? `<span class="sch-slot-end">→ ${st.end_time}</span>` : ''}
                      <span class="sch-slot-seats${st.seats_free <= 10 ? ' low' : ''}">${st.seats_free <= 10 ? 'Sắp hết · ' + st.seats_free : 'Còn ' + st.seats_free + ' ghế'}</span>
                    </a>` : `
                    <span class="sch-slot-card" style="opacity: .5; cursor: not-allowed;">
                      <span class="sch-slot-time">${st.time}</span>
                      <span class="sch-slot-seats">Hết vé</span>
                    </span>`).join('')}
                </div>`).join('')}
            </div>
          </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<p style="padding: 40px 0; text-align: center; color: #dc2626;">Không tải được lịch chiếu (${esc(e.message)}). Vui lòng thử lại.</p>`;
  }
}

(async function init() {
  try {
    const [c, first] = await Promise.all([Pay.catalog('cinemas'), Pay.catalog('showtimes', { days: 1 })]);
    today = first.today;
    currentDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today;
    CINEMAS = c.cinemas;
    if (!CINEMAS.some(x => x.id === currentCinema)) currentCinema = (favs().find(id => CINEMAS.some(x => x.id === id))) || (CINEMAS[0] ? CINEMAS[0].id : '');
    renderCinemaSelect();
    renderDateBar();
    await loadShowtimes();
  } catch (e) {
    document.getElementById('sch-list').innerHTML = `<p style="padding: 40px 0; text-align: center; color: #dc2626;">Không tải được dữ liệu rạp (${esc(e.message)}).</p>`;
  }
})();
