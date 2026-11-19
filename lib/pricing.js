// lib/pricing.js - Server tự tính tiền đơn hàng, không tin số tiền trình duyệt gửi lên
// Giá phải khớp với giao diện (public/seats.html, public/js/pay-client.js -> COMBOS)

const SEAT_PRICE = { standard: 45000, vip: 50000, sweetbox: 100000 };
const COMBO_PRICE = { solo: 69000, couple: 89000, party: 129000, family: 129000, sausage: 25000 };
// Giảm giá tối đa chấp nhận từ voucher (voucher chưa lưu ở server nên chỉ chặn trên)
const MAX_DISCOUNT_RATIO = 0.5;

// A-E: ghế thường, F-G: VIP, H1-H2...: ghế đôi Sweetbox
function seatType(id) {
  const s = String(id || '').trim().toUpperCase();
  if (/^H\d+-H\d+$/.test(s)) return 'sweetbox';
  if (/^[FG]\d{1,2}$/.test(s)) return 'vip';
  if (/^[A-E]\d{1,2}$/.test(s)) return 'standard';
  return null;
}

/**
 * Tính tiền đơn hàng.
 * Trả về { ok, error?, seatsTotal, combosTotal, subtotal, discount, total }
 */
function priceOrder({ seats, combos, total }) {
  const list = Array.isArray(seats) ? seats : String(seats || '').split(',');
  const clean = list.map(s => String(s).trim().toUpperCase()).filter(Boolean);
  if (!clean.length) return { ok: false, error: 'Chưa chọn ghế' };
  if (clean.length > 8) return { ok: false, error: 'Mỗi đơn tối đa 8 ghế' };
  if (new Set(clean).size !== clean.length) return { ok: false, error: 'Ghế bị trùng' };

  let seatsTotal = 0;
  for (const s of clean) {
    const t = seatType(s);
    if (!t) return { ok: false, error: 'Mã ghế không hợp lệ: ' + s };
    seatsTotal += SEAT_PRICE[t];
  }

  let combosTotal = 0;
  for (const [k, q] of Object.entries(combos || {})) {
    const qty = Number(q);
    if (!COMBO_PRICE[k] || !Number.isInteger(qty) || qty < 0 || qty > 10) return { ok: false, error: 'Combo không hợp lệ: ' + k };
    combosTotal += COMBO_PRICE[k] * qty;
  }

  const subtotal = seatsTotal + combosTotal;
  // Số tiền trình duyệt gửi lên chỉ được thấp hơn giá gốc trong giới hạn giảm giá cho phép
  const asked = Number(total);
  let discount = 0;
  if (Number.isFinite(asked) && asked < subtotal) {
    discount = Math.min(subtotal - asked, Math.floor(subtotal * MAX_DISCOUNT_RATIO));
  }
  return { ok: true, seats: clean, seatsTotal, combosTotal, subtotal, discount, total: subtotal - discount };
}

module.exports = { priceOrder, seatType, SEAT_PRICE, COMBO_PRICE };
