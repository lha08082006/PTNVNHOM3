const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DB, sepay, newOrder, expire, reset } = require('./helpers');
const webhook = require('../api/sepay-webhook');

beforeEach(reset);

const txs = () => Array.from(DB.__mock().bank_transactions.values());
const refunds = () => Array.from(DB.__mock().refunds.values());

test('US1: thanh toán đủ -> PAID, ghế SOLD, giao dịch OK', async () => {
  const order = await newOrder();
  const r = await sepay(webhook, { code: order.code, amount: 90000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'OK');
  const saved = await DB.getOrderByCode(order.code);
  assert.equal(saved.status, 'PAID');
  assert.ok(saved.paid_at);
  assert.equal(txs()[0].result, 'OK');
  assert.equal(txs()[0].order_id, order.id);
  const holds = Array.from(DB.__mock().seat_holds.values());
  assert.ok(holds.every(h => h.status === 'SOLD'));
});

test('US1: mã đơn nằm trong nội dung chuyển khoản vẫn được nhận diện', async () => {
  const order = await newOrder();
  const r = await sepay(webhook, { content: `MBVCB.123 ${order.code} NGUYEN VAN A`, amount: 90000 });
  assert.equal(r.body.result, 'OK');
});

test('US1: gửi lại cùng id -> không cộng tiền lần 2', async () => {
  const order = await newOrder();
  await sepay(webhook, { code: order.code, amount: 90000, id: 555 });
  const r = await sepay(webhook, { code: order.code, amount: 90000, id: 555 });
  assert.equal(r.body.duplicate, true);
  const saved = await DB.getOrderByCode(order.code);
  assert.equal(saved.paid_amount, 90000);
  assert.equal(refunds().length, 0);
});

test('US1: cùng mã tham chiếu ngân hàng, khác id -> DUPLICATE, không cộng tiền', async () => {
  const order = await newOrder();
  await sepay(webhook, { code: order.code, amount: 50000, referenceCode: 'FT999' });
  const r = await sepay(webhook, { code: order.code, amount: 50000, referenceCode: 'FT999' });
  assert.equal(r.body.result, 'DUPLICATE');
  const saved = await DB.getOrderByCode(order.code);
  assert.equal(saved.paid_amount, 50000);
});

test('US1: thiếu / sai Authorization -> 401, không ghi sổ cái', async () => {
  const order = await newOrder();
  const r1 = await sepay(webhook, { code: order.code, amount: 90000, headers: {} });
  const r2 = await sepay(webhook, { code: order.code, amount: 90000, headers: { authorization: 'Apikey wrong' } });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(txs().length, 0);
  assert.equal((await DB.getOrderByCode(order.code)).status, 'HOLDING');
});

test('US1: nội dung không có mã đơn -> UNMATCHED, không ghép vào đơn đang chờ', async () => {
  const order = await newOrder();
  const r = await sepay(webhook, { content: 'chuyen tien', amount: 90000 });
  assert.equal(r.body.result, 'UNMATCHED');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'HOLDING');
  assert.equal(txs()[0].result, 'UNMATCHED');
});

test('US1: mã đơn không tồn tại -> UNMATCHED, không tự tạo đơn', async () => {
  const r = await sepay(webhook, { code: 'BC1111111111', amount: 90000 });
  assert.equal(r.body.result, 'UNMATCHED');
  assert.equal(DB.__mock().orders.size, 0);
});

test('US1: giao dịch tiền ra -> IGNORED', async () => {
  const order = await newOrder();
  const r = await sepay(webhook, { code: order.code, amount: 90000, transferType: 'out' });
  assert.equal(r.body.result, 'IGNORED');
  assert.equal((await DB.getOrderByCode(order.code)).paid_amount, 0);
});

test('US1: thiếu id giao dịch -> 400', async () => {
  const r = await sepay(webhook, { code: 'BC1', amount: 1, id: 'abc' });
  assert.equal(r.status, 400);
});

test('US2: trả thiếu còn hạn -> PARTIAL; chuyển bù đủ -> PAID', async () => {
  const order = await newOrder();
  const r1 = await sepay(webhook, { code: order.code, amount: 50000 });
  assert.equal(r1.body.result, 'SHORT');
  assert.equal(r1.body.status, 'PARTIAL');
  assert.equal(r1.body.remaining_amount, 40000);
  const r2 = await sepay(webhook, { code: order.code, amount: 40000 });
  assert.equal(r2.body.result, 'OK');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'PAID');
  assert.equal(refunds().length, 0);
});

test('US2: trả thiếu rồi hết hạn -> EXPIRED + hoàn phần đã trả (SHORT); khoản chuyển sau hạn hoàn riêng (LATE)', async () => {
  const order = await newOrder();
  await sepay(webhook, { code: order.code, amount: 50000 });
  await expire(order);
  const r = await sepay(webhook, { code: order.code, amount: 40000 });
  assert.equal(r.body.result, 'LATE');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'EXPIRED');
  const byReason = Object.fromEntries(refunds().map(x => [x.reason, x.amount]));
  assert.deepEqual(byReason, { SHORT: 50000, LATE: 40000 });
});

test('US3: trả thừa còn hạn -> PAID + hoàn phần thừa (EXCESS)', async () => {
  const order = await newOrder();
  const r = await sepay(webhook, { code: order.code, amount: 111000 });
  assert.equal(r.body.result, 'EXCESS');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'PAID');
  assert.equal(refunds().length, 1);
  assert.equal(refunds()[0].reason, 'EXCESS');
  assert.equal(refunds()[0].amount, 21000);
  assert.equal(refunds()[0].bank_tx_id, txs()[0].id);
});

test('US3: trả thừa sau hạn -> EXPIRED + hoàn 100% (LATE)', async () => {
  const order = await newOrder();
  await expire(order);
  const r = await sepay(webhook, { code: order.code, amount: 111000 });
  assert.equal(r.body.result, 'LATE');
  assert.equal(refunds()[0].amount, 111000);
});

test('US4: trả đủ sau hạn -> EXPIRED, LATE, hoàn 100%, ghế được nhả', async () => {
  const order = await newOrder();
  await expire(order);
  const r = await sepay(webhook, { code: order.code, amount: 90000 });
  assert.equal(r.body.result, 'LATE');
  assert.equal((await DB.getOrderByCode(order.code)).status, 'EXPIRED');
  assert.equal(refunds()[0].reason, 'LATE');
  assert.equal(refunds()[0].amount, 90000);
  assert.equal(DB.__mock().seat_holds.size, 0);
});

test('Đơn đã PAID nhận thêm tiền -> DUPLICATE + hoàn khoản mới', async () => {
  const order = await newOrder();
  await sepay(webhook, { code: order.code, amount: 90000 });
  const r = await sepay(webhook, { code: order.code, amount: 90000 });
  assert.equal(r.body.result, 'DUPLICATE');
  assert.equal(refunds()[0].reason, 'DUPLICATE');
  assert.equal(refunds()[0].amount, 90000);
});
