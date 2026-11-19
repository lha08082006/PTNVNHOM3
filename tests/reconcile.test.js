const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DB, call, sepay, newOrder, expire, reset } = require('./helpers');
const reconcile = require('../api/reconcile');
const webhook = require('../api/sepay-webhook');

beforeEach(reset);

async function lagTx(order, { amount = 90000, ref = 'FT12345678', code = order.code } = {}) {
  return DB.insertBankTransaction({
    id: 777, code, amount, reference_code: ref, content: `${code} ck`, result: 'ERROR'
  });
}

test('US5: giao dịch trễ webhook, đơn còn hạn -> RECOVERED_PAID', async () => {
  const order = await newOrder();
  await lagTx(order);
  const r = await call(reconcile, { body: { order_code: order.code, bank_ref: 'FT12345678' } });
  assert.equal(r.body.status, 'RECOVERED_PAID');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'PAID');
  assert.equal(DB.__mock().bank_transactions.get('777').result, 'RECOVERED');
});

test('US5: đối soát lặp lại không cộng tiền lần 2', async () => {
  const order = await newOrder();
  await lagTx(order);
  await call(reconcile, { body: { bank_ref: 'FT12345678' } });
  const r = await call(reconcile, { body: { bank_ref: 'FT12345678' } });
  assert.equal(r.body.status, 'RECOVERED_PAID');
  assert.equal((await DB.getOrderByCode(order.code)).paid_amount, 90000);
});

test('US5: giao dịch tìm thấy, đơn hết hạn -> RECOVERED_REFUND có refund_code', async () => {
  const order = await newOrder();
  await lagTx(order);
  await expire(order);
  const r = await call(reconcile, { body: { order_code: order.code, bank_ref: 'FT12345678' } });
  assert.equal(r.body.status, 'RECOVERED_REFUND');
  assert.match(r.body.refund_code, /^REF-\d{4}-\d{6}$/);
});

test('US5: giao dịch đã được webhook xử lý -> báo lại kết quả, không áp lại', async () => {
  const order = await newOrder();
  await sepay(webhook, { code: order.code, amount: 90000, referenceCode: 'FT1' });
  const r = await call(reconcile, { body: { bank_ref: 'FT1' } });
  assert.equal(r.body.status, 'RECOVERED_PAID');
  assert.equal((await DB.getOrderByCode(order.code)).paid_amount, 90000);
});

test('US5: không dùng giao dịch của đơn khác', async () => {
  const a = await newOrder();
  const b = await newOrder({ seats: ['B1'] });
  await lagTx(a);
  const r = await call(reconcile, { body: { order_code: b.code, bank_ref: 'FT12345678' } });
  assert.equal(r.status, 409);
  assert.equal((await DB.getOrderByCode(b.code)).status, 'HOLDING');
});

test('US5: không tìm thấy giao dịch -> COMPLAINT_CREATED', async () => {
  const order = await newOrder();
  const r = await call(reconcile, { body: { order_code: order.code, bank_ref: 'FT00000000' } });
  assert.equal(r.body.status, 'COMPLAINT_CREATED');
  assert.match(r.body.complaint_code, /^CS-\d{4}-\d{6}$/);
});

test('US5: thiếu cả mã đơn lẫn mã giao dịch -> 400', async () => {
  const r = await call(reconcile, { body: {} });
  assert.equal(r.status, 400);
});
