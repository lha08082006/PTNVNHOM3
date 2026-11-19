// lib/points.js - Beta Club: điểm thưởng & hạng thành viên (Đợt 2)
//
// Sổ điểm (point_ledger) chỉ ghi thêm, không sửa số dư trực tiếp. Mỗi dòng có "ref" duy nhất
// nên gọi lại nhiều lần (webhook trùng, cron chạy chồng) không cộng/trừ trùng:
//   EARN:<mã đơn>      cộng điểm khi đơn xuất vé (CONFIRMED / CONFIRMED_LATE)
//   REDEEM:<mã đơn>    trừ điểm khi khách dùng điểm trả tiền (lúc tạo đơn)
//   RETURN:<mã đơn>    trả lại điểm đã dùng khi đơn không thành (hủy / hoàn tiền / thất bại)
//   BDAY:<khách>:<năm> quà sinh nhật
//   EXPIRE:<khách>:<ngày> điểm hết hạn (do Job hằng ngày ghi)
// Điểm "hết hạn" tính theo nguyên tắc: điểm sắp hết hạn được dùng trước.
const Store = require('./store');
const Catalog = require('../catalog');

const L = Catalog.LOYALTY;
const DAY = 24 * 3600e3;
const iso = (d) => new Date(d).toISOString();
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];
const KIND_LABEL = { EARN: 'Tích điểm', REDEEM: 'Dùng điểm', RETURN: 'Hoàn điểm', BIRTHDAY: 'Quà sinh nhật', EXPIRE: 'Điểm hết hạn', ADJUST: 'Điều chỉnh' };

async function add(row) {
  try {
    return await Store.insert('point_ledger', { ...row, created_at: row.created_at || iso(Date.now()) });
  } catch (e) {
    if (e.code === '23505') return null; // đã ghi rồi (idempotent)
    throw e;
  }
}

// Tổng chi tiêu 365 ngày (đơn đã xuất vé) -> hạng
async function spend365(customerId, now = new Date()) {
  const since = iso(now.getTime() - 365 * DAY);
  const rows = await Store.find('orders', { user_id: customerId, status: { in: PAID } }, { limit: 2000 });
  return rows.filter(o => (o.confirmed_at || o.created_at) >= since).reduce((s, o) => s + Number(o.total || 0), 0);
}

// Số dư = tổng các dòng − phần điểm đã quá hạn mà chưa được dùng
function summarize(rows, now = new Date()) {
  const t = now.getTime();
  let total = 0, debits = 0, expired = 0, soon = 0;
  for (const r of rows) {
    const p = Number(r.points) || 0;
    total += p;
    if (p < 0) debits += -p;
    else if (r.expires_at) {
      const e = new Date(r.expires_at).getTime();
      if (e <= t) expired += p;
      else if (e <= t + 30 * DAY) soon += p;
    }
  }
  const pendingExpire = Math.max(0, expired - debits);
  const expiringSoon = Math.max(0, expired + soon - debits) - pendingExpire;
  return { balance: total - pendingExpire, pendingExpire, expiringSoon };
}

async function ledger(customerId) {
  return Store.find('point_ledger', { customer_id: customerId }, { order: 'created_at', asc: false, limit: 1000 });
}

async function balance(customerId, now = new Date()) {
  return summarize(await ledger(customerId), now).balance;
}

// Cộng điểm cho đơn vừa xuất vé (theo hạng TRƯỚC đơn này)
async function earn(order, now = new Date()) {
  if (!order || !order.user_id || !PAID.includes(order.status)) return null;
  const seat = Object.values(order.seat_prices || {}).reduce((s, v) => s + Number(v || 0), 0);
  const fnb = Object.entries(order.combos || {}).reduce((s, [k, q]) => s + ((Catalog.COMBOS[k] || {}).price || 0) * Number(q || 0), 0);
  const gross = seat + fnb;
  const cash = Number(order.total) || 0; // tiền thực trả (đã trừ voucher và điểm)
  if (!gross || !cash) return null;
  const spend = (await spend365(order.user_id, now)) - cash;
  const tier = Catalog.tierOf(spend);
  const pts = Math.floor((cash * seat / gross * tier.ticket / 100 + cash * fnb / gross * tier.fnb / 100) / L.POINT_VALUE);
  if (pts <= 0) return null;
  return add({
    ref: 'EARN:' + order.code, customer_id: order.user_id, order_code: order.code, kind: 'EARN', points: pts,
    expires_at: iso(addMonths(now, L.EXPIRE_MONTHS)), note: `Hạng ${tier.label}: ${tier.ticket}% vé, ${tier.fnb}% bắp nước`
  });
}

// Trừ điểm khi tạo đơn. Ghi trước rồi kiểm tra lại số dư: hai đơn cùng lúc dùng chung số điểm -> đơn sau bị từ chối.
async function redeem(customerId, orderCode, points, now = new Date()) {
  if (!(points > 0)) return null;
  const have = await balance(customerId, now);
  if (points > have) throw httpError(`Bạn chỉ còn ${have} điểm`, 400);
  const row = await add({ ref: 'REDEEM:' + orderCode, customer_id: customerId, order_code: orderCode, kind: 'REDEEM', points: -points, note: 'Trả tiền đơn ' + orderCode });
  if ((await balance(customerId, now)) < 0) {
    await Store.remove('point_ledger', { ref: 'REDEEM:' + orderCode });
    throw httpError('Số điểm vừa được dùng cho đơn khác, vui lòng thử lại', 409);
  }
  return row;
}

// Đơn không thành -> trả lại điểm đã dùng (hạn dùng mới 12 tháng)
async function restore(order, now = new Date()) {
  if (!order || !order.user_id || !(Number(order.points_used) > 0)) return null;
  if (!(await Store.one('point_ledger', { ref: 'REDEEM:' + order.code }))) return null;
  return add({
    ref: 'RETURN:' + order.code, customer_id: order.user_id, order_code: order.code, kind: 'RETURN', points: Number(order.points_used),
    expires_at: iso(addMonths(now, L.EXPIRE_MONTHS)), note: 'Trả lại điểm do đơn ' + order.code + ' không thành công'
  });
}

// Gọi từ Flow.transition sau mỗi lần đổi trạng thái đơn
async function onStatus(order, now = new Date()) {
  try {
    if (PAID.includes(order.status)) return await earn(order, now);
    if (['CANCELLED', 'FAILED', 'REFUND_REQUESTED', 'REFUNDED'].includes(order.status)) return await restore(order, now);
  } catch (e) { console.warn('[points]', order.code, e.message); }
  return null;
}

// Job hằng ngày: ghi điểm hết hạn + quà sinh nhật. Trả về danh sách khách cần nhắc điểm sắp hết hạn.
async function daily(now = new Date()) {
  const out = { expired: 0, birthday: 0, expiring: [] };
  const vn = new Date(now.getTime() + 7 * 3600e3);
  const ym = vn.toISOString().slice(5, 7);
  const customers = await Store.find('customers', {}, { limit: 20000 });
  for (const c of customers) {
    if (c.birthday && String(c.birthday).slice(5, 7) === ym) {
      const r = await add({
        ref: `BDAY:${c.id}:${vn.getUTCFullYear()}`, customer_id: c.id, kind: 'BIRTHDAY', points: L.BIRTHDAY_POINTS,
        expires_at: iso(now.getTime() + L.BIRTHDAY_DAYS * DAY), note: 'Quà sinh nhật Beta Club'
      });
      if (r) out.birthday++;
    }
    const s = summarize(await ledger(c.id), now);
    if (s.pendingExpire > 0) {
      await add({ ref: `EXPIRE:${c.id}:${vn.toISOString().slice(0, 10)}`, customer_id: c.id, kind: 'EXPIRE', points: -s.pendingExpire, note: 'Điểm quá hạn 12 tháng' });
      out.expired += s.pendingExpire;
    }
    if (s.expiringSoon > 0) out.expiring.push({ customer: c, points: s.expiringSoon });
  }
  return out;
}

// Dữ liệu cho trang Tài khoản
async function overview(customer, now = new Date()) {
  const rows = await ledger(customer.id);
  const s = summarize(rows, now);
  const spend = await spend365(customer.id, now);
  const tier = Catalog.tierOf(spend);
  const next = L.TIERS.find(t => t.min > spend) || null;
  return {
    balance: s.balance, balance_value: s.balance * L.POINT_VALUE, expiring_soon: s.expiringSoon,
    spend_365: spend, tier, next_tier: next ? { ...next, need: next.min - spend } : null,
    rules: L,
    history: rows.slice(0, 50).map(r => ({ at: r.created_at, kind: r.kind, kind_label: KIND_LABEL[r.kind] || r.kind, points: r.points, order_code: r.order_code || null, note: r.note || '', expires_at: r.expires_at || null }))
  };
}

module.exports = { earn, redeem, restore, onStatus, daily, overview, balance, summarize, spend365, KIND_LABEL };
