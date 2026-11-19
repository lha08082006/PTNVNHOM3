// lib/pricing.js - Bảng giá dùng chung ở server (nguồn sự thật cho tổng tiền đơn hàng)
// Giá phải khớp với giao diện: seats.html (data-price), combo.html / checkout.html (COMBOS), voucher ở checkout.html.

const SEAT_PRICES = {
  standard: 45000, // Hàng A - E
  vip: 50000       // Hàng F - G
};

const SEAT_ROWS = {
  A: 'standard', B: 'standard', C: 'standard', D: 'standard', E: 'standard',
  F: 'vip', G: 'vip'
};

const MAX_SEAT_NUMBER = 10;
const MAX_SEATS_PER_ORDER = 10;
const MAX_COMBO_QTY = 20;

const COMBO_PRICES = {
  solo: 69000,
  couple: 89000,
  party: 129000,
  family: 129000,
  sausage: 25000
};

const VOUCHERS = {
  BETAVIP: 20000,
  ALPHA: 20000,
  CINEMA: 20000
};

class PricingError extends Error {
  constructor(message) {
    super(message);
    this.code = 'INVALID_ORDER';
  }
}

// Chuẩn hóa mã ghế: "d5" / "D05" -> "D5"
function normalizeSeat(raw) {
  const m = String(raw || '').trim().toUpperCase().match(/^([A-Z])0*(\d{1,2})$/);
  if (!m) return null;
  const row = m[1];
  const num = Number(m[2]);
  if (!SEAT_ROWS[row] || num < 1 || num > MAX_SEAT_NUMBER) return null;
  return row + num;
}

function seatPrice(seatId) {
  return SEAT_PRICES[SEAT_ROWS[seatId[0]]];
}

/**
 * Tính tổng tiền đơn hàng từ ghế, combo, voucher.
 * @returns {{ seats: string[], combos: object, voucher: string|null, seatTotal: number,
 *            comboTotal: number, discount: number, total: number }}
 * @throws {PricingError} khi dữ liệu không hợp lệ
 */
function quote({ seats, combos, voucher } = {}) {
  if (!Array.isArray(seats) || seats.length === 0) {
    throw new PricingError('Vui lòng chọn ít nhất 1 ghế');
  }
  if (seats.length > MAX_SEATS_PER_ORDER) {
    throw new PricingError(`Mỗi đơn chỉ được đặt tối đa ${MAX_SEATS_PER_ORDER} ghế`);
  }

  const normSeats = [];
  for (const s of seats) {
    const id = normalizeSeat(s);
    if (!id) throw new PricingError('Mã ghế không hợp lệ: ' + s);
    if (normSeats.includes(id)) throw new PricingError('Ghế bị chọn trùng: ' + id);
    normSeats.push(id);
  }
  const seatTotal = normSeats.reduce((sum, id) => sum + seatPrice(id), 0);

  const normCombos = {};
  let comboTotal = 0;
  if (combos && typeof combos === 'object' && !Array.isArray(combos)) {
    for (const [key, rawQty] of Object.entries(combos)) {
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty < 0 || qty > MAX_COMBO_QTY) {
        throw new PricingError('Số lượng combo không hợp lệ: ' + key);
      }
      if (qty === 0) continue;
      if (!COMBO_PRICES[key]) throw new PricingError('Combo không tồn tại: ' + key);
      normCombos[key] = qty;
      comboTotal += COMBO_PRICES[key] * qty;
    }
  }

  const voucherCode = voucher ? String(voucher).trim().toUpperCase() : null;
  const discount = voucherCode && VOUCHERS[voucherCode] ? VOUCHERS[voucherCode] : 0;

  return {
    seats: normSeats,
    combos: normCombos,
    voucher: discount > 0 ? voucherCode : null,
    seatTotal,
    comboTotal,
    discount,
    total: Math.max(0, seatTotal + comboTotal - discount)
  };
}

module.exports = { quote, normalizeSeat, PricingError, SEAT_PRICES, COMBO_PRICES, VOUCHERS };
