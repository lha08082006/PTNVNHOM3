// js/seats.js - mã của seats.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Danh mục tên phim
const MOVIE_NAMES = {
  'linh-gioi-dai-chien': 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
  'dia-dao': 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
  'quy-an-tang-4': 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI',
  'trai-buon-nguoi': 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI',
  'blue-lock': 'BLUE LOCK: THE MOVIE - EPISODE NAGI',
  'an-mang-karaoke': 'ÁN MẠNG KARAOKE',
  'ut-lan-2': 'ÚT LAN 2',
  'co-dau-hao-mon': 'ÚT LAN 2',
  'suzume': 'KHÓA CHẶT CỬA NÀO SUZUME',
  'ca-voi-nuot-chung': 'CÁ VOI NUỐT CHỬNG',
  'me-min': 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI',
  'shaun-the-sheep': 'SHAUN THE SHEEP: PHIÊU LƯU NGOÀI HÀNH TINH'
};

// Danh sách ghế đang được chọn
let selectedSeats = [];
// Giá ghế theo suất chiếu (database); mặc định giá trong catalog.js
let SHOWTIME = null;
let PRICES = BetaCatalog.SEAT_PRICES;
// Sơ đồ ghế của phòng chiếu (máy chủ gửi kèm suất chiếu); mặc định sơ đồ chuẩn
let LAYOUT = BetaCatalog.DEFAULT_LAYOUT;
const sType = (id) => BetaCatalog.seatType(id, LAYOUT);
const seatPrice = (id) => PRICES[sType(id)] || 0;

function renderGrid() {
  const esc = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rows = LAYOUT.rows;
  document.getElementById('seat-rows').innerHTML = rows.map(x => {
    const cls = x.type === 'vip' ? ' v' : x.type === 'sweetbox' ? ' d' : '';
    let h = '<div class="r' + cls + '" data-row="' + esc(x.r) + '"><u>' + esc(x.r) + '</u>';
    for (let k = 1; k <= x.n; k++) {
      const id = x.type === 'sweetbox' ? x.r + (2 * k - 1) + '-' + x.r + (2 * k) : x.r + k;
      h += (x.off || []).includes(k)
        ? '<i class="off" aria-hidden="true" style="visibility: hidden;"></i>'
        : '<i data-id="' + esc(id) + '" data-type="' + x.type + '" data-price="' + (PRICES[x.type] || 0) + '">' + esc(x.type === 'sweetbox' ? id : k) + '</i>';
      if ((x.gaps || []).includes(k)) h += '<b style="width: 24px;"></b>';
    }
    return h + '<u>' + esc(x.r) + '</u></div>';
  }).join('');
  const g = document.querySelector('.seat-plan-scroll');
  if (g && rows.length) g.setAttribute('aria-label', 'Sơ đồ ghế, hàng ' + rows[0].r + ' đến ' + rows[rows.length - 1].r + '. Dùng phím Tab để di chuyển, Enter hoặc Space để chọn ghế');
  bindSeats();
}

let currentMovieKey = 'linh-gioi-dai-chien';
let currentCinema = 'Beta Thanh Xuân';
let currentDate = (window.Pay && Pay.getTodayTag) ? Pay.getTodayTag() : 'Hôm nay';
let currentTime = '12:15';

// Đọc URL query params
function initParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('movie')) currentMovieKey = params.get('movie');
  if (params.get('cinema')) currentCinema = params.get('cinema');
  if (params.get('date')) currentDate = params.get('date');
  if (params.get('time')) currentTime = params.get('time');
  // Quay lại từ bước combo: giữ nguyên các ghế khách đã chọn
  (params.get('seats') || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean).forEach(id => {
    const el = document.querySelector('.r i[data-id="' + id + '"]');
    if (el && sType(id) && !selectedSeats.some(x => x.id === id)) {
      el.classList.add('s');
      selectedSeats.push({ id, type: sType(id), price: seatPrice(id) });
    }
  });

  const movieObj = (window.Pay && Pay.getMovie) ? Pay.getMovie(currentMovieKey) : null;
  const movieTitle = movieObj ? (movieObj.shortTitle || movieObj.title) : (MOVIE_NAMES[currentMovieKey] || 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ');
  document.getElementById('checkout-movie-title').textContent = movieTitle;
  document.getElementById('subbar-cinema').textContent = currentCinema;
  document.getElementById('subbar-date').textContent = currentDate;
  document.getElementById('subbar-time').textContent = currentTime;

  const backUrl = 'booking.html?movie=' + encodeURIComponent(currentMovieKey);
  document.getElementById('btn-back-link').href = backUrl;

  const selectEl = document.getElementById('cinema-select');
  if (window.BetaChrome && BetaChrome.loadCinemas) {
    BetaChrome.loadCinemas().then(list => {
      if (!list || !list.length) return;
      const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const curId = (typeof SHOWTIME === 'object' && SHOWTIME && SHOWTIME.cinema_id) || '';
      selectEl.innerHTML = list.map(c => `<option value="${esc(c.id)}" ${(curId ? c.id === curId : c.name === currentCinema) ? 'selected' : ''}>${esc(c.name)}${c.city ? ' (' + esc(c.city) + ')' : ''}</option>`).join('');
      selectEl.onchange = () => {
        try { if (window.BetaRememberCinema) BetaRememberCinema(selectEl.value); } catch (e) { /* bỏ qua */ }
        location.href = 'schedule.html?cinema=' + encodeURIComponent(selectEl.value);
      };
    }).catch(() => { /* giữ ô như cũ khi mất mạng */ });
  }

  updateSummary();
}

// Accessibility: ghế là nút bấm được bằng bàn phím, đọc được trạng thái
const SEAT_TYPE_LABEL = { standard: 'thường', vip: 'VIP', sweetbox: 'Sweetbox' };
function syncSeatA11y(el) {
  const unavailable = el.classList.contains('x') || el.classList.contains('h') || el.classList.contains('k');
  const selected = el.classList.contains('s');
  const type = SEAT_TYPE_LABEL[el.dataset.type] || '';
  const state = unavailable ? (el.title || 'Không còn trống') : (selected ? 'Đang chọn' : 'Còn trống');
  el.setAttribute('aria-label', 'Ghế ' + el.dataset.id + (type ? ' ' + type : '') + ', ' + state);
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (unavailable) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
}
const seatObserver = new MutationObserver(list => list.forEach(m => syncSeatA11y(m.target)));
function bindSeats() {
document.querySelectorAll('.r i[data-id]').forEach(seat => {
  seat.setAttribute('role', 'button');
  seat.setAttribute('tabindex', '0');
  syncSeatA11y(seat);
  seatObserver.observe(seat, { attributes: true, attributeFilter: ['class', 'title'] });
  seat.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seat.click(); }
  });
});

// Gắn sự kiện click chọn ghế
document.querySelectorAll('.r i[data-id]').forEach(seat => {
  seat.addEventListener('click', function() {
    if (this.classList.contains('x') || this.classList.contains('h') || this.classList.contains('k')) {
      return;
    }

    const id = this.dataset.id;
    const type = sType(id);
    const price = seatPrice(id);

    const existsIndex = selectedSeats.findIndex(s => s.id === id);
    if (existsIndex > -1) {
      selectedSeats.splice(existsIndex, 1);
      this.classList.remove('s');
    } else {
      if (selectedSeats.length >= BetaCatalog.MAX_SEATS) {
        alert('Mỗi đơn đặt tối đa ' + BetaCatalog.MAX_SEATS + ' ghế.');
        return;
      }
      selectedSeats.push({ id, type, price });
      this.classList.add('s');
    }

    updateSummary();
  });
});
}

// Cập nhật thanh tóm tắt & tính tổng tiền
// ---------- Loại vé ----------
let TYPES = BetaCatalog.TICKET_TYPES;
let CHILD_OFF = false; // phim từ T13 trở lên: không bán vé Trẻ em
const typeCounts = Pay.typesFromUrl();
const eligibleCount = () => selectedSeats.filter(s => s.type !== 'sweetbox').length;
const specialCount = () => Object.values(typeCounts).reduce((a, b) => a + b, 0);
function renderTypes() {
  const panel = document.getElementById('ticket-type-panel');
  // Chỉ hiện khi máy chủ đang áp dụng ít nhất một loại vé ưu đãi (ngoài Người lớn / Ghế đôi)
  const hasSpecial = Object.keys(TYPES || {}).some(k => k !== 'ADULT' && k !== 'COUPLE');
  panel.hidden = selectedSeats.length === 0 || !hasSpecial;
  // Bớt ghế thì bớt vé ưu đãi tương ứng (ưu đãi lớn bị bớt sau cùng)
  let over = specialCount() - eligibleCount();
  const order = Object.keys(typeCounts).sort((a, b) => ((TYPES[a] || {}).off || 0) - ((TYPES[b] || {}).off || 0));
  for (const k of order) { while (over > 0 && typeCounts[k] > 0) { typeCounts[k]--; over--; } if (!typeCounts[k]) delete typeCounts[k]; }
  const adults = eligibleCount() - specialCount();
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  document.getElementById('tt-list').innerHTML = Object.entries(TYPES).map(([code, t]) => {
    const n = code === 'ADULT' ? adults : (typeCounts[code] || 0);
    const canAdd = code !== 'ADULT' && adults > 0;
    return `<div style="border: 1.5px solid ${n ? 'var(--a, #005198)' : 'var(--border-dark, #cbd5e1)'}; border-radius: 10px; padding: 10px 12px; display: flex; justify-content: space-between; gap: 10px; align-items: center;">
          <div style="min-width: 0;">
            <b style="font-size: 14px;">${esc(t.label)}</b>${t.off ? ` <span style="color: #15803d; font-weight: 800; font-size: 12.5px;">−${Pay.vnd(t.off)}</span>` : ''}
            ${t.note ? `<div class="m" style="font-size: 12px; line-height: 1.4;">${esc(t.note)}</div>` : ''}
          </div>
          ${code === 'ADULT' ? `<b style="font-size: 16px; min-width: 24px; text-align: center;" aria-label="Số vé người lớn">${n}</b>` : `
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <button type="button" class="o" style="min-width: 34px; min-height: 34px; padding: 0;" aria-label="Bớt vé ${esc(t.label)}" data-on-click="changeType('${code}', -1)" ${n ? '' : 'disabled'}>−</button>
            <b style="min-width: 20px; text-align: center;" aria-live="polite">${n}</b>
            <button type="button" class="o" style="min-width: 34px; min-height: 34px; padding: 0;" aria-label="Thêm vé ${esc(t.label)}" data-on-click="changeType('${code}', 1)" ${canAdd ? '' : 'disabled'}>+</button>
          </div>`}
        </div>`;
  }).join('') + (CHILD_OFF ? `<div class="m" style="font-size: 12px; line-height: 1.4;">Phim ${esc(SHOWTIME.movie.age)}: không bán vé Trẻ em (dưới 13 tuổi).</div>` : '');
  const rules = (SHOWTIME && SHOWTIME.prices && SHOWTIME.prices.rules) || [];
  document.getElementById('tt-price-note').textContent = rules.length ? 'Giá suất này: ' + rules.join(' · ') + (SHOWTIME.prices.holiday ? ' (' + SHOWTIME.prices.holiday + ')' : '') : '';
}
function changeType(code, d) {
  const next = (typeCounts[code] || 0) + d;
  if (next < 0 || (d > 0 && specialCount() >= eligibleCount())) return;
  if (next) typeCounts[code] = next; else delete typeCounts[code];
  updateSummary();
}

function updateSummary() {
  renderTypes();
  const seatsDisplay = document.getElementById('checkout-selected-seats');
  const totalDisplay = document.getElementById('checkout-total-price');
  const metaDisplay = document.getElementById('checkout-meta-detail');
  const btnNext = document.getElementById('btn-next-step') || document.getElementById('btn-next-checkout');

  if (selectedSeats.length === 0) {
    seatsDisplay.textContent = 'Chưa chọn ghế';
    totalDisplay.textContent = '0đ';
    metaDisplay.textContent = 'Vui lòng chọn ghế trên sơ đồ khán phòng';
    btnNext.classList.add('disabled'); btnNext.setAttribute('aria-disabled', 'true');
    btnNext.removeAttribute('href');
  } else {
    const seatIds = selectedSeats.map(s => s.id).join(', ');
    // Tạm tính theo đúng công thức máy chủ (giá ghế của suất + giảm theo loại vé)
    let total = selectedSeats.reduce((sum, s) => sum + s.price, 0);
    try { total = BetaCatalog.quote({ seats: seatIds, prices: PRICES, ticket_types: typeCounts, types: TYPES, layout: LAYOUT }).seat_total; } catch (e) {}
    seatsDisplay.textContent = seatIds;
    totalDisplay.textContent = new Intl.NumberFormat('vi-VN').format(total) + 'đ';

    const count = selectedSeats.length;
    metaDisplay.textContent = ((SHOWTIME && SHOWTIME.room) || 'Phòng chiếu') + ' · ' + count + ' Ghế (' + new Intl.NumberFormat('vi-VN').format(total) + 'đ)';
    btnNext.classList.remove('disabled'); btnNext.removeAttribute('aria-disabled');

    // Chuyển tiếp mượt mà sang bước 3: Chọn bắp nước (combo.html)
    const comboUrl = 'combo.html?showtime=' + encodeURIComponent(SHOWTIME ? SHOWTIME.id : '') + '&seats=' + encodeURIComponent(seatIds) +
      (specialCount() ? '&types=' + encodeURIComponent(JSON.stringify(typeCounts)) : '');
    btnNext.href = comboUrl;
  }
}

// Đánh dấu ghế đang có người giữ / đã bán theo dữ liệu thật của suất chiếu (NFR-05)
// Chọn giúp ghế đẹp: tìm dãy ghế trống liền nhau (không vượt lối đi / ghế bỏ trống) cùng loại,
// ưu tiên hàng ở khoảng 2/3 phía sau màn hình và gần giữa hàng nhất.
function setupAutoPick() {
  const types = [...new Set(LAYOUT.rows.map(r => r.type))];
  const label = { standard: 'Ghế thường', vip: 'Ghế VIP', sweetbox: 'Ghế đôi' };
  const typeSel = document.getElementById('ap-type'), countSel = document.getElementById('ap-count');
  typeSel.innerHTML = types.map(t => '<option value="' + t + '"' + (t === 'vip' ? ' selected' : '') + '>' + label[t] + '</option>').join('');
  const fillCount = () => {
    const max = typeSel.value === 'sweetbox' ? Math.floor(BetaCatalog.MAX_SEATS / 2) : BetaCatalog.MAX_SEATS;
    const cur = Number(countSel.value) || 2;
    countSel.innerHTML = Array.from({ length: max }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === Math.min(cur, max) ? ' selected' : '') + '>' + (i + 1) + (typeSel.value === 'sweetbox' ? ' cặp' : ' ghế') + '</option>').join('');
  };
  typeSel.onchange = fillCount;
  fillCount();
  document.getElementById('ap-go').onclick = () => {
    const want = Number(countSel.value), type = typeSel.value, msg = document.getElementById('ap-msg');
    msg.textContent = '';
    const free = (id) => { const el = document.querySelector('.r i[data-id="' + id + '"]'); return el && !el.classList.contains('x') && !el.classList.contains('h') && !el.classList.contains('k'); };
    const target = (LAYOUT.rows.length - 1) * 0.6;
    let best = null;
    LAYOUT.rows.forEach((x, ri) => {
      if (x.type !== type) return;
      const idOf = (k) => x.type === 'sweetbox' ? x.r + (2 * k - 1) + '-' + x.r + (2 * k) : x.r + k;
      let run = [];
      const flush = () => {
        for (let s = 0; s + want <= run.length; s++) {
          const win = run.slice(s, s + want);
          const mid = (win[0] + win[win.length - 1]) / 2;
          const score = Math.abs(ri - target) * 2 + Math.abs(mid - (x.n + 1) / 2) / Math.max(1, x.n / 6);
          if (!best || score < best.score) best = { score, ids: win.map(idOf) };
        }
        run = [];
      };
      for (let k = 1; k <= x.n; k++) {
        if ((x.off || []).includes(k) || !free(idOf(k))) flush(); else run.push(k);
        if ((x.gaps || []).includes(k)) flush();
      }
      flush();
    });
    if (!best) { msg.textContent = 'Không còn ' + want + ' ' + (type === 'sweetbox' ? 'cặp ghế đôi' : 'ghế') + ' liền nhau loại này. Thử ít ghế hơn hoặc loại khác.'; return; }
    selectedSeats.slice().forEach(s => { const el = document.querySelector('.r i[data-id="' + s.id + '"]'); if (el) el.click(); });
    best.ids.forEach(id => { const el = document.querySelector('.r i[data-id="' + id + '"]'); if (el) el.click(); });
    const first = document.querySelector('.r i[data-id="' + best.ids[0] + '"]');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    msg.style.color = '#15803d';
    msg.textContent = 'Đã chọn ' + best.ids.join(', ');
  };
}

async function markTakenSeats() {
  if (!window.Pay || !Pay.getTakenSeats) return;
  if (!SHOWTIME) return;
  const key = SHOWTIME.id;
  const taken = await Pay.getTakenSeats(key);
  taken.forEach(t => {
    const el = document.querySelector('.r i[data-id="' + t.seat + '"]');
    if (!el || el.classList.contains('x') || el.classList.contains('h')) return;
    el.classList.remove('s');
    el.classList.add(t.status === 'SOLD' ? 'x' : 'h');
    el.title = t.status === 'SOLD' ? 'Đã bán' : 'Đang có người giữ';
    const k = selectedSeats.findIndex(s => s.id === t.seat);
    if (k > -1) selectedSeats.splice(k, 1);
  });
  if (taken.length) updateSummary();
}

// Trang ghế luôn gắn với một suất chiếu thật: seats.html?showtime=<id>
(async function init() {
  const id = new URLSearchParams(location.search).get('showtime');
  SHOWTIME = await Pay.getShowtime(id);
  if (!SHOWTIME || !SHOWTIME.active) {
    alert('Suất chiếu không tồn tại hoặc đã ngừng bán. Vui lòng chọn lại suất chiếu.');
    location.replace('schedule.html');
    return;
  }
  currentMovieKey = SHOWTIME.movie_key;
  currentCinema = SHOWTIME.cinema;
  { const cs = document.getElementById('cinema-select'); if (cs && SHOWTIME.cinema_id && [...cs.options].some(o => o.value === SHOWTIME.cinema_id)) cs.value = SHOWTIME.cinema_id; }
  currentDate = SHOWTIME.date_label;
  currentTime = SHOWTIME.time;
  PRICES = SHOWTIME.prices;
  if (SHOWTIME.layout) LAYOUT = SHOWTIME.layout;
  const pr = await Pay.pricing();
  if (pr && pr.ticket_types) TYPES = pr.ticket_types;
  CHILD_OFF = !!TYPES.CHILD && ['T13', 'T16', 'T18'].includes(String((SHOWTIME.movie && SHOWTIME.movie.age) || '').toUpperCase());
  if (CHILD_OFF) { TYPES = { ...TYPES }; delete TYPES.CHILD; delete typeCounts.CHILD; }
  ['standard', 'vip', 'sweetbox'].forEach(t => { const el = document.getElementById('lg-' + t); if (el) el.textContent = Pay.vnd(PRICES[t]).replace(' ', ''); });
  renderGrid();
  setupAutoPick();
  initParams();
  markTakenSeats();
})();
setInterval(markTakenSeats, 15000);
