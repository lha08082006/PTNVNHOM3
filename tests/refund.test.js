const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DB, call, sepay, newOrder, expire, reset } = require('./helpers');
const refundApi = require('../api/refund');
const webhook = require('../api/sepay-webhook');

beforeEach(reset);

async function lateRefund() {
  const order = await newOrder();
  await expire(order);
  await sepay(webhook, { code: order.code, amount: 90000 });
  return { order, refund: await DB.getRefund({ order_id: order.id }) };
}

test('US6: gửi đủ thông tin -> RECEIVED, tên viết hoa, số TK được che', async () => {
  const { refund } = await lateRefund();
  const r = await call(refundApi, {
    body: { code: refund.code, bank_name: 'MB Bank', acc_number: '0123 456 789', acc_name: 'nguyen van a' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'RECEIVED');
  assert.equal(r.body.acc_name, 'NGUYEN VAN A');
  assert.equal(r.body.acc_number, '******6789');
  const saved = await DB.getRefund({ code: refund.code });
  assert.equal(saved.acc_number, '0123456789');
  assert.ok(saved.received_at);
});

test('US6: thiếu trường -> 400', async () => {
  const { refund } = await lateRefund();
  const r = await call(refundApi, { body: { code: refund.code, bank_name: 'MB', acc_number: '0123456789' } });
  assert.equal(r.status, 400);
});

test('US6: không tự tạo hồ sơ hoàn cho đơn chưa nhận tiền', async () => {
  const order = await newOrder();
  const r = await call(refundApi, {
    body: { order_code: order.code, bank_name: 'MB', acc_number: '0123456789', acc_name: 'A' }
  });
  assert.equal(r.status, 404);
  assert.equal(DB.__mock().refunds.size, 0);
});

test('US6: tra cứu theo mã hồ sơ trả về cả đơn hàng', async () => {
  const { order, refund } = await lateRefund();
  const r = await call(refundApi, { method: 'GET', query: { code: refund.code } });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.code, order.code);
});

test('US6: tra cứu theo mã đơn', async () => {
  const { order, refund } = await lateRefund();
  const r = await call(refundApi, { method: 'GET', query: { order_code: order.code } });
  assert.equal(r.body.refund.code, refund.code);
});

test('US6: hồ sơ đã duyệt thì không cho đổi tài khoản', async () => {
  const { refund } = await lateRefund();
  await DB.updateRefund(refund.code, { status: 'APPROVED' });
  const r = await call(refundApi, {
    body: { code: refund.code, bank_name: 'MB', acc_number: '0123456789', acc_name: 'A' }
  });
  assert.equal(r.status, 409);
});
