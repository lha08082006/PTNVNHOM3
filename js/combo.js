// js/combo.js - mã của combo.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
// Bước chọn combo: gắn với suất chiếu thật (combo.html?showtime=<id>&seats=...)
const params = new URLSearchParams(window.location.search);
const showtimeId = params.get('showtime') || '';
const selectedSeatsStr = params.get('seats') || '';
let ticketTotal = 0;
let typeSummary = '';
const typeCounts = Pay.typesFromUrl(); // loại vé chọn ở bước Ghế
let seatCount = 0;

const items = {};
for (const k in BetaCatalog.COMBOS) items[k] = { ...BetaCatalog.COMBOS[k], qty: 0 };

// Dựng thẻ combo từ catalog.js
(function renderComboGrid() {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' đ';
  document.getElementById('combo-grid').innerHTML = Object.entries(BetaCatalog.COMBOS).map(([k, c]) => `
        <div class="combo-card"${c.badge === 'Bán chạy nhất' ? ' style="border: 2px solid var(--beta-orange);"' : ''}>
          <div class="combo-img-wrap">
            <img src="${esc(c.img || 'images/combo.webp')}" alt="${esc(c.name)}" loading="lazy">
            ${c.badge ? `<span class="combo-badge"${c.badge === 'Bán chạy nhất' ? ' style="background: var(--beta-orange);"' : ''}>${esc(c.badge)}</span>` : ''}
          </div>
          <div class="combo-body">
            <h3 class="combo-title">${esc(c.name)}</h3>
            <p class="combo-desc">${esc(c.desc || '')}</p>
            <div class="combo-footer">
              <div class="combo-price">${vnd(c.price)}</div>
              <div class="quantity-control">
                <button type="button" class="qty-btn" aria-label="Bớt ${esc(c.name)}" data-on-click="updateQty('${k}', -1)">−</button>
                <span class="qty-value" id="qty-${k}" aria-live="polite">0</span>
                <button type="button" class="qty-btn" aria-label="Thêm ${esc(c.name)}" data-on-click="updateQty('${k}', 1)">+</button>
              </div>
            </div>
          </div>
        </div>`).join('');
})();

// Khôi phục combo nếu có tham số URL
try {
  const parsed = JSON.parse(params.get('combos') || '{}');
  for (let k in parsed) {
    if (items[k]) {
      items[k].qty = Number(parsed[k]) || 0;
      const el = document.getElementById('qty-' + k);
      if (el) el.innerText = items[k].qty;
    }
  }
} catch (e) {}

function updateQty(key, delta) {
  if (!items[key]) return;
  const newQty = items[key].qty + delta;
  if (newQty >= 0 && newQty <= BetaCatalog.MAX_COMBO_QTY) {
    items[key].qty = newQty;
    const qtyEl = document.getElementById('qty-' + key);
    if (qtyEl) qtyEl.innerText = items[key].qty;
    recalcTotal();
  }
}

function recalcTotal() {
  let comboTotal = 0;
  const comboSummary = [];
  const combosPayload = {};
  for (const k in items) {
    if (items[k].qty > 0) {
      comboTotal += items[k].price * items[k].qty;
      comboSummary.push(items[k].qty + ' ' + items[k].name);
      combosPayload[k] = items[k].qty;
    }
  }
  const grandTotal = ticketTotal + comboTotal;
  document.getElementById('order-summary-detail').innerText = seatCount + ' Vé (' + Pay.vnd(ticketTotal) + ')' + (comboSummary.length ? ' + ' + comboSummary.join(', ') : '');
  document.getElementById('total-amount-display').innerText = Pay.vnd(grandTotal);
  const base = 'showtime=' + encodeURIComponent(showtimeId) + '&seats=' + encodeURIComponent(selectedSeatsStr) +
    (Object.keys(typeCounts).length ? '&types=' + encodeURIComponent(JSON.stringify(typeCounts)) : '');
  document.getElementById('btn-next-checkout').href = 'checkout.html?' + base + '&combos=' + encodeURIComponent(JSON.stringify(combosPayload));
  document.getElementById('btn-back-seats').href = 'seats.html?' + base;
}

(async function init() {
  const st = await Pay.getShowtime(showtimeId);
  if (!st || !st.active) { alert('Suất chiếu không tồn tại hoặc đã ngừng bán.'); location.replace('schedule.html'); return; }
  if (!selectedSeatsStr) { location.replace('seats.html?showtime=' + encodeURIComponent(showtimeId)); return; }
  // Tiền vé tính theo giá ghế của suất chiếu, không tin số tiền trên URL
  try {
    const pr = await Pay.pricing();
    const q = BetaCatalog.quote({ seats: selectedSeatsStr, prices: st.prices, ticket_types: typeCounts, types: (pr && pr.ticket_types) || undefined, layout: st.layout || null });
    typeSummary = Object.entries(q.ticket_types).map(([c, n]) => n + ' ' + (((pr && pr.ticket_types) || BetaCatalog.TICKET_TYPES)[c] || {}).label).join(', ');
    ticketTotal = q.seat_total;
    seatCount = q.seats.length;
  } catch (e) {
    alert(e.message);
    location.replace('seats.html?showtime=' + encodeURIComponent(showtimeId));
    return;
  }
  const m = Pay.getMovie(st.movie_key);
  document.getElementById('combo-movie-display').textContent = m.title + (m.age ? ' · ' + m.age : '');
  document.getElementById('combo-seat-summary').textContent = selectedSeatsStr + ' (' + seatCount + ' ghế' + (typeSummary ? ', gồm ' + typeSummary : '') + ')';
  document.getElementById('combo-cinema-showtime').textContent = st.cinema + ' · ' + st.time + ' (' + st.date_label + ')';
  document.getElementById('combo-ticket-total-display').textContent = 'Tiền vé: ' + Pay.vnd(ticketTotal);
  recalcTotal();
})();
