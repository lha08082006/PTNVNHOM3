// js/checkout.js - mã của checkout.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
const MOVIE_DETAILS = (window.Pay && Pay.MOVIES) ? Pay.MOVIES : {
  'linh-gioi-dai-chien': {
    title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
    shortTitle: 'Linh Giới Đại Chiến',
    age: 'T18',
    poster: 'images/400x633-145627-230926-40.jpg'
  }
};

// Giá combo / ghế / voucher lấy từ catalog.js – cùng nguồn với máy chủ khi tạo đơn
const COMBOS = {};
for (const k in BetaCatalog.COMBOS) COMBOS[k] = { ...BetaCatalog.COMBOS[k], qty: 0 };

// Dựng danh sách combo từ catalog.js (cùng tên, mô tả với trang Combo)
(function renderCheckoutCombos() {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' đ';
  document.getElementById('checkout-combo-list').innerHTML = Object.entries(BetaCatalog.COMBOS).map(([k, c]) => `
          <div class="combo-item-row">
            <div class="combo-thumb"><img src="${esc(c.img || 'images/combo.webp')}" alt="${esc(c.name)}" loading="lazy"></div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; font-size: 15px;">${esc(c.name)}</div>
              <div class="m" style="font-size: 12.5px; line-height: 1.4;">${esc(c.desc || '')} · <strong style="color: var(--status-warning);">${vnd(c.price)}</strong></div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" class="o qty-btn-sm" aria-label="Bớt ${esc(c.name)}" data-on-click="changeQty('${k}', -1)">−</button>
              <b id="qty-${k}" aria-live="polite" style="min-width: 22px; text-align: center; font-size: 15px;">0</b>
              <button type="button" class="o qty-btn-sm" aria-label="Thêm ${esc(c.name)}" data-on-click="changeQty('${k}', 1)">+</button>
            </div>
          </div>`).join('');
})();
let voucherCode = null;
let SHOWTIME = null; // suất chiếu thật (database)
let TYPES = null;    // bảng loại vé đang áp dụng
const typeCounts = Pay.typesFromUrl();
let seatLabel = '';

let baseSeatPrice = 90000;
let discountAmount = 0;
let VOUCHER_DEF = null;
let POINTS_HAVE = 0, pointsUsed = 0; // Beta Club // voucher đã kiểm tra trên máy chủ (gồm điều kiện)
let selectedSeatsStr = '';
let currentMovie = 'linh-gioi-dai-chien';
let currentCinema = 'Beta Thanh Xuân';
let currentDate = (window.Pay && Pay.getTodayTag) ? Pay.getTodayTag() : 'Hôm nay';
let currentTime = '12:15';

// Đọc query parameters
function parseParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('seats')) selectedSeatsStr = p.get('seats');
  try {
    const q = BetaCatalog.quote({ seats: selectedSeatsStr, prices: SHOWTIME.prices, ticket_types: typeCounts, types: TYPES || undefined, layout: SHOWTIME.layout || null });
    baseSeatPrice = q.seat_total;
    const T = TYPES || BetaCatalog.TICKET_TYPES;
    const groups = {};
    q.seats.forEach(s => { const k = s.ticket_type === 'COUPLE' ? 'Ghế đôi' : (T[s.ticket_type] || {}).label || s.ticket_type; (groups[k] = groups[k] || []).push(s.id); });
    seatLabel = Object.entries(groups).map(([k, ids]) => k + ': ' + ids.join(', ')).join(' · ');
  } catch (e) {
    alert('Vui lòng chọn ghế trước khi thanh toán.');
    location.replace('seats.html?' + p.toString());
    return;
  }

  // Đọc combo từ URL nếu được chuyển từ combo.html
  const combosParam = p.get('combos');
  // Đảm bảo reset toàn bộ về 0 trước khi nạp dữ liệu từ URL
  for (let k in COMBOS) COMBOS[k].qty = 0;
  if (combosParam) {
    try {
      const parsedCombos = JSON.parse(decodeURIComponent(combosParam));
      for (let k in parsedCombos) {
        if (COMBOS[k]) {
          COMBOS[k].qty = Number(parsedCombos[k]) || 0;
        }
      }
    } catch (e) {
      console.warn('Lỗi parse combosParam:', e.message);
    }
  }

  // Cập nhật số lượng trên giao diện
  for (let k in COMBOS) {
    const qtyEl = document.getElementById('qty-' + k);
    if (qtyEl) qtyEl.textContent = COMBOS[k].qty;
  }

  const movieObj = (window.Pay && Pay.getMovie) ? Pay.getMovie(currentMovie) : (MOVIE_DETAILS[currentMovie] || MOVIE_DETAILS['linh-gioi-dai-chien']);
  document.getElementById('summary-movie-title').textContent = movieObj.shortTitle || movieObj.title;
  document.getElementById('summary-movie-age').textContent = movieObj.age;
  const ageLbl = document.getElementById('terms-age-label');
  if (ageLbl && movieObj.age && movieObj.age !== 'P') ageLbl.textContent = ' (' + movieObj.age + ')';
  document.getElementById('summary-movie-poster').src = movieObj.poster;

  document.getElementById('summary-cinema-hall').textContent = currentCinema + ' · ' + (SHOWTIME.room || 'Phòng 01');
  document.getElementById('summary-showtime').textContent = currentDate + ' · ' + currentTime;

  // Ghế
  const seatCount = selectedSeatsStr.split(',').length;
  document.getElementById('summary-seat-label').textContent = (seatLabel || 'Ghế ' + selectedSeatsStr) + ' × ' + seatCount;
  document.getElementById('summary-seat-amount').textContent = new Intl.NumberFormat('vi-VN').format(baseSeatPrice) + ' đ';

  // Nút back quay về combo.html
  const backUrl = 'combo.html?showtime=' + encodeURIComponent(SHOWTIME.id) + '&seats=' + encodeURIComponent(selectedSeatsStr) +
                  (Object.keys(typeCounts).length ? '&types=' + encodeURIComponent(JSON.stringify(typeCounts)) : '') +
                  '&combos=' + encodeURIComponent(p.get('combos') || '{}');
  document.getElementById('btn-back-seats').href = backUrl;

  calcTotal();
}

// Tăng giảm số lượng bắp nước
function changeQty(key, delta) {
  if (!COMBOS[key]) return;
  COMBOS[key].qty = Math.min(BetaCatalog.MAX_COMBO_QTY, Math.max(0, COMBOS[key].qty + delta));
  document.getElementById('qty-' + key).textContent = COMBOS[key].qty;
  calcTotal();
}

// Áp dụng voucher
async function applyVoucher() {
  const code = document.getElementById('voucher-input').value.trim().toUpperCase();
  const msgEl = document.getElementById('voucher-msg');
  if (!code) {
    msgEl.textContent = 'Vui lòng nhập mã giảm giá!';
    msgEl.style.color = '#ef4444';
    return;
  }
  try {
    const v = (await Pay.catalog('voucher', { code })).voucher;
    voucherCode = v.code;
    VOUCHER_DEF = v;
    msgEl.textContent = '✓ Áp dụng thành công mã ' + v.code + (v.label ? ': ' + v.label : '') + '!';
    msgEl.style.color = 'var(--status-live)';
  } catch (e) {
    voucherCode = null;
    VOUCHER_DEF = null;
    discountAmount = 0;
    msgEl.textContent = e.message || 'Mã giảm giá không hợp lệ hoặc đã hết lượt dùng.';
    msgEl.style.color = '#ef4444';
    document.getElementById('summary-discount-row').style.display = 'none';
  }
  calcTotal();
}

// Tính toán tổng đơn hàng
function calcTotal() {
  let comboTotal = 0;
  const combosBox = document.getElementById('summary-combos-box');
  combosBox.innerHTML = '';

  for (let k in COMBOS) {
    if (COMBOS[k].qty > 0) {
      const itemTotal = COMBOS[k].qty * COMBOS[k].price;
      comboTotal += itemTotal;

      const row = document.createElement('p');
      row.className = 'ln';
      row.innerHTML = '<span class="m">' + COMBOS[k].name + ' × ' + COMBOS[k].qty + '</span><span style="font-weight:600;">' + new Intl.NumberFormat('vi-VN').format(itemTotal) + ' đ</span>';
      combosBox.appendChild(row);
    }
  }

  // Voucher có điều kiện (đơn tối thiểu, kèm combo, thứ trong tuần, giảm %) – cùng công thức máy chủ
  discountAmount = 0;
  const dRow = document.getElementById('summary-discount-row');
  if (VOUCHER_DEF) {
    const msgEl = document.getElementById('voucher-msg');
    try {
      const dow = SHOWTIME ? new Date(new Date(SHOWTIME.starts_at).getTime() + 7 * 3600e3).getUTCDay() : null;
      discountAmount = BetaCatalog.voucherDiscount(VOUCHER_DEF.code, VOUCHER_DEF, { base: baseSeatPrice + comboTotal, combo_total: comboTotal, seat_count: selectedSeatsStr.split(',').filter(Boolean).length, show_dow: dow });
      msgEl.textContent = '✓ Áp dụng mã ' + VOUCHER_DEF.code + ': giảm ' + Pay.vnd(discountAmount) + (VOUCHER_DEF.label ? ' (' + VOUCHER_DEF.label + ')' : '') + '.';
      msgEl.style.color = 'var(--status-live)';
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.style.color = '#ef4444';
    }
  }
  if (dRow) dRow.style.display = discountAmount ? 'flex' : 'none';
  const dAmt = document.getElementById('summary-discount-amount');
  if (dAmt) dAmt.textContent = '-' + new Intl.NumberFormat('vi-VN').format(discountAmount) + ' đ';
  voucherCode = discountAmount ? (VOUCHER_DEF && VOUCHER_DEF.code) : null;
  // Điểm Beta Club: tối đa 50% giá trị đơn sau voucher và không quá số điểm đang có (máy chủ kiểm tra lại)
  const afterVoucher = Math.max(0, baseSeatPrice + comboTotal - discountAmount);
  pointsUsed = 0;
  if (POINTS_HAVE > 0) {
    const cap = Math.min(POINTS_HAVE, BetaCatalog.maxPointsFor(afterVoucher));
    const inp = document.getElementById('points-input');
    inp.max = cap;
    document.getElementById('points-hint').textContent = 'Tối đa ' + cap + ' điểm cho đơn này';
    if (document.getElementById('points-use').checked) {
      let n = Math.floor(Number(inp.value) || 0);
      if (!n) n = cap;
      n = Math.max(0, Math.min(cap, n));
      inp.value = n;
      pointsUsed = n;
    }
  }
  const pRow = document.getElementById('summary-points-row');
  if (pRow) {
    pRow.style.display = pointsUsed ? 'flex' : 'none';
    document.getElementById('summary-points-amount').textContent = '-' + new Intl.NumberFormat('vi-VN').format(pointsUsed * 1000) + ' đ (' + pointsUsed + ' điểm)';
  }
  const finalTotal = Math.max(0, afterVoucher - pointsUsed * 1000);
  document.getElementById('summary-total-amount').textContent = new Intl.NumberFormat('vi-VN').format(finalTotal) + ' đ';
  return finalTotal;
}

// Xử lý nút Thanh toán ngay
async function doCheckout() {
  const agreed = document.getElementById('terms-checkbox').checked;
  if (!agreed) {
    alert('Vui lòng tích chọn đồng ý với điều khoản mua vé!');
    return;
  }

  const finalTotal = calcTotal();
  const seatArray = selectedSeatsStr.split(',').map(s => s.trim()).filter(Boolean);
  const combosPayload = {};
  for (let k in COMBOS) {
    if (COMBOS[k].qty > 0) combosPayload[k] = COMBOS[k].qty;
  }

  // Lấy nút theo id (an toàn hơn querySelector với onclick attribute)
  const btn = document.getElementById('btn-submit-pay');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang khởi tạo đơn hàng...';
  }

  // Hàm reset nút nếu có lỗi và không redirect được
  const resetBtn = () => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Thanh toán ngay';
    }
  };

  try {
    // Máy chủ tạo đơn PENDING và khóa ghế nguyên tử 10 phút (Tầng 1 bắt đầu từ đây)
    await Pay.createOrderAndGo({
      showtime_id: SHOWTIME.id,
      seats: seatArray,
      combos: combosPayload,
      ticket_types: typeCounts,
      voucher: voucherCode,
      points: pointsUsed,
      total: finalTotal
    });
  } catch (err) {
    console.error('[Checkout] Không tạo được đơn:', err);
    if (err.status === 401) {
      location.href = BetaAuth.loginUrl();
      return;
    }
    if (err.status === 409 && /Giá đơn hàng/.test(err.message)) {
      alert(err.message);
      resetBtn();
      return;
    }
    if (err.status === 409) {
      alert(err.message + ' Bạn sẽ được đưa về sơ đồ ghế để chọn lại.');
      location.href = 'seats.html?showtime=' + encodeURIComponent(SHOWTIME.id);
      return;
    }
    alert('Không tạo được đơn hàng (' + err.message + '). Bạn chưa bị trừ tiền – vui lòng thử lại.');
    resetBtn();
  }
}


(async function init() {
  // Đặt vé cần tài khoản thành viên: đơn và e-ticket gắn với hồ sơ thật
  if (window.BetaAuth) await BetaAuth.requireLogin();
  SHOWTIME = await Pay.getShowtime(new URLSearchParams(location.search).get('showtime'));
  if (!SHOWTIME || !SHOWTIME.active) {
    alert('Suất chiếu không tồn tại hoặc đã ngừng bán. Vui lòng chọn lại suất chiếu.');
    location.replace('schedule.html');
    return;
  }
  currentMovie = SHOWTIME.movie_key;
  currentCinema = SHOWTIME.cinema;
  currentDate = SHOWTIME.date_label;
  currentTime = SHOWTIME.time;
  const pr = await Pay.pricing();
  if (pr && pr.ticket_types) TYPES = pr.ticket_types;
  parseParams();
  // Số điểm Beta Club hiện có
  try {
    const p = await Pay.call('member?action=points');
    POINTS_HAVE = p.balance || 0;
    if (POINTS_HAVE > 0) {
      document.getElementById('points-have').textContent = POINTS_HAVE.toLocaleString('vi-VN');
      document.getElementById('points-box').hidden = false;
      calcTotal();
    }
  } catch (e) { /* chưa có điểm hoặc lỗi mạng: bỏ qua, vẫn thanh toán bình thường */ }
})();
