const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DB, call, reset } = require('./helpers');
const createOrder = require('../api/create-order');
const orders = require('../api/orders');
const { quote } = require('../lib/pricing');

beforeEach(reset);

const base = { movie_key: 'phim', cinema: 'Beta', show_date: 'T5 19/11', show_time: '19:30', phone: '0912345678' };

test('Bảng giá: ghế thường 45k, VIP 50k, combo, voucher', () => {
  const q = quote({ seats: ['d5', 'F1'], combos: { solo: 1, sausage: 2 }, voucher: 'betavip' });
  assert.deepEqual(q.seats, ['D5', 'F1']);
  assert.equal(q.total, 45000 + 50000 + 69000 + 50000 - 20000);
  assert.equal(q.voucher, 'BETAVIP');
  assert.equal(quote({ seats: ['A1'], voucher: 'FAKE' }).total, 45000);
});

test('US1: tổng tiền client sai -> server dùng giá tính lại', async () => {
  const r = await call(createOrder, { body: { ...base, seats: ['D5', 'D6'], combos: { solo: 1 }, total: 1000 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 159000);
  assert.equal((await DB.getOrderByCode(r.body.code)).total, 159000);
});

test('Dữ liệu không hợp lệ -> 400', async () => {
  for (const body of [
    { ...base, seats: [] },
    { ...base, seats: ['Z99'] },
    { ...base, seats: ['A1', 'A1'] },
    { ...base, seats: ['A1'], combos: { bogus: 1 } },
    { ...base, seats: ['A1'], combos: { solo: -1 } },
    { seats: ['A1'] }
  ]) {
    const r = await call(createOrder, { body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('FR-016: hai đơn cùng ghế cùng suất -> đơn sau bị 409', async () => {
  const r1 = await call(createOrder, { body: { ...base, seats: ['D5', 'D6'] } });
  const r2 = await call(createOrder, { body: { ...base, seats: ['D6', 'D7'] } });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 409);
  // Suất khác thì vẫn đặt được
  const r3 = await call(createOrder, { body: { ...base, show_time: '21:00', seats: ['D6'] } });
  assert.equal(r3.status, 200);
});

test('FR-016: ghế được nhả khi đơn hết hạn', async () => {
  const r1 = await call(createOrder, { body: { ...base, seats: ['D5'] } });
  await DB.updateOrder(r1.body.id, { status: 'EXPIRED' });
  const r2 = await call(createOrder, { body: { ...base, seats: ['D5'] } });
  assert.equal(r2.status, 200);
});

test('US7: danh sách đơn bắt buộc phone, lọc đúng chủ đơn, limit an toàn', async () => {
  await call(createOrder, { body: { ...base, seats: ['A1'] } });
  await call(createOrder, { body: { ...base, seats: ['A2'], phone: '0999999999' } });
  assert.equal((await call(orders, { method: 'GET', query: {} })).status, 400);
  const r = await call(orders, { method: 'GET', query: { phone: '0912345678', limit: '-5' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.orders.length, 1);
  assert.equal(r.body.orders[0].phone, '0912345678');
});
