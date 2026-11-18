// tools/smoke-test.js - Kiểm thử nhanh toàn bộ luồng chính ở chế độ bộ nhớ trong (không đụng Supabase thật)
// Chạy: npm test
process.env.DB_MODE = 'mock';
delete process.env.ADMIN_KEY;
delete process.env.SEPAY_WEBHOOK_KEY;
delete process.env.AUTH_SECRET;

const assert = require('assert');
const api = (name) => require('../api/' + name);

// Gọi handler kiểu Vercel trong cùng tiến trình
async function call(name, { method = 'GET', query = {}, body = {}, token, headers = {} } = {}) {
  const req = { method, query, body, headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) } };
  let status = 200;
  let data;
  const res = {
    status(c) { status = c; return this; },
    json(d) { data = d; return this; },
    setHeader() {}, end() {}
  };
  await api(name)(req, res);
  return { status, data };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name + ' → ' + e.message]); }
}

(async () => {
  let tokA, tokB, code;

  await test('Đăng ký + đăng nhập', async () => {
    const r = await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khach A', email: 'a@test.vn', phone: '0901000001', password: 'matkhau123' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    tokA = r.data.token;
    const dup = await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khach Trung', email: 'A@test.vn', phone: '0901000009', password: 'matkhau123' } });
    assert.strictEqual(dup.status, 409);
    const bad = await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: 'a@test.vn', password: 'sai' } });
    assert.strictEqual(bad.status, 401);
    const ok = await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: '0901000001', password: 'matkhau123' } });
    assert.strictEqual(ok.status, 200);
    const b = await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khach B', email: 'b@test.vn', phone: '0901000002', password: 'matkhau123' } });
    tokB = b.data.token;
  });

  await test('Đặt vé bắt buộc đăng nhập', async () => {
    const r = await call('create-order', { method: 'POST', body: { movie_key: 'suzume', seats: ['A1'] } });
    assert.strictEqual(r.status, 401);
  });

  await test('Máy chủ tự tính giá, chặn sửa giá', async () => {
    const base = { movie_key: 'suzume', cinema: 'Beta Thanh Xuân', show_date: 'T5 19/11', show_time: '20:00' };
    const cheat = await call('create-order', { method: 'POST', token: tokA, body: { ...base, seats: ['A1'], total: 1000 } });
    assert.strictEqual(cheat.status, 409);
    const fake = await call('create-order', { method: 'POST', token: tokA, body: { ...base, seats: ['Z99'] } });
    assert.strictEqual(fake.status, 400);
    const r = await call('create-order', { method: 'POST', token: tokA, body: { ...base, seats: ['A1', 'F2', 'H1-H2'], combos: { couple: 1 }, voucher: 'betavip' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.total, 45000 + 50000 + 100000 + 89000 - 20000);
    code = r.data.code;
  });

  await test('Không bán trùng ghế', async () => {
    const r = await call('create-order', { method: 'POST', token: tokB, body: { movie_key: 'suzume', cinema: 'Beta Thanh Xuân', show_date: 'T5 19/11', show_time: '20:00', seats: ['F2'] } });
    assert.strictEqual(r.status, 409);
  });

  await test('Lịch sử đơn chỉ thấy đơn của mình', async () => {
    const a = await call('orders', { token: tokA });
    assert.strictEqual(a.data.orders.length, 1);
    const b = await call('orders', { token: tokB });
    assert.strictEqual(b.data.orders.length, 0);
    const anon = await call('orders');
    assert.strictEqual(anon.status, 401);
  });

  await test('Thanh toán (sandbox) -> xuất vé', async () => {
    const r = await call('simulate-payment', { method: 'POST', body: { scenario: 'OK', order_code: code } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const s = await call('order-status', { query: { code } });
    assert.strictEqual(s.data.status, 'CONFIRMED');
    assert.strictEqual(s.data.has_ticket, true);
    assert.strictEqual(s.data.customer_name, 'Khach A');
  });

  await test('Phiếu hỗ trợ', async () => {
    const r = await call('support', { method: 'POST', body: { category: 'SERVICE', phone: '0901000001', description: 'Điều hòa phòng chiếu quá lạnh' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.ticket_code, /^CS-\d{6}$/);
    const bad = await call('support', { method: 'POST', body: { category: 'SERVICE', phone: '123', description: 'Điều hòa phòng chiếu quá lạnh' } });
    assert.strictEqual(bad.status, 400);
  });

  await test('Đổi mật khẩu làm phiên cũ hết hạn', async () => {
    const r = await call('auth', { method: 'POST', query: { action: 'password' }, token: tokA, body: { current_password: 'matkhau123', new_password: 'matkhaumoi1' } });
    assert.strictEqual(r.status, 200);
    const old = await call('auth', { query: { action: 'me' }, token: tokA });
    assert.strictEqual(old.status, 401);
    const fresh = await call('auth', { query: { action: 'me' }, token: r.data.token });
    assert.strictEqual(fresh.status, 200);
  });

  await test('Webhook SePay kiểm tra khóa khi có đặt', async () => {
    process.env.SEPAY_WEBHOOK_KEY = 'khoa-test';
    const no = await call('sepay-webhook', { method: 'POST', body: {} });
    assert.strictEqual(no.status, 401);
    const yes = await call('sepay-webhook', { method: 'POST', headers: { authorization: 'Apikey khoa-test' }, body: { id: 1, transferType: 'in', transferAmount: 1000, content: 'khong co ma', referenceCode: 'FTTEST1' } });
    assert.strictEqual(yes.status, 200, JSON.stringify(yes.data));
    delete process.env.SEPAY_WEBHOOK_KEY;
  });

  await test('Hoàn tiền thủ công: gửi Kế toán → trả về → gửi lại → chi → hoàn tất', async () => {
    const Store = require('../lib/store');
    const K = { 'x-admin-key': 'beta-admin' };
    const admin = (body) => call('admin', { method: 'POST', headers: K, body });
    const order = await Store.one('orders', { code });
    const mk = async (c) => Store.insert('refunds', {
      code: c, order_id: order.id, order_code: code, amount: 50000, reason: 'MISMATCH', status: 'FORM_SUBMITTED',
      idempotency_key: 'test-' + c, deadline_at: new Date().toISOString(), is_manual: true,
      bank_name: 'MB Bank', acc_number: '0123456789', acc_name: 'KHACH A', receipt_url: 'data:image/png;base64,AA==', form_submitted_at: new Date().toISOString()
    });
    await mk('REF-T1'); await mk('REF-T2');

    const noActor = await admin({ action: 'send_to_accounting', refund_codes: ['REF-T1'] });
    assert.strictEqual(noActor.status, 400);
    const sent = await admin({ action: 'send_to_accounting', refund_codes: ['REF-T1', 'REF-T2', 'REF-KHONGCO'], actor: 'NV Lan' });
    assert.strictEqual(sent.data.sent, 2, JSON.stringify(sent.data));
    assert.strictEqual(sent.data.results.find(r => r.code === 'REF-KHONGCO').ok, false);

    const noReason = await admin({ action: 'accounting_reject', refund_code: 'REF-T1', actor: 'KT Minh' });
    assert.strictEqual(noReason.status, 400);
    const rej = await admin({ action: 'accounting_reject', refund_code: 'REF-T1', reason: 'WRONG_ACCOUNT', note: 'STK sai 1 số', actor: 'KT Minh' });
    assert.strictEqual(rej.status, 200, JSON.stringify(rej.data));
    assert.strictEqual(rej.data.refund.status, 'ACC_RETURNED');
    assert.strictEqual(rej.data.refund.returned_count, 1);
    // Hồ sơ đã trả về thì Kế toán không chi được nữa
    const payReturned = await admin({ action: 'accounting_paid', refund_code: 'REF-T1', refund_ref: 'FT1', actor: 'KT Minh' });
    assert.strictEqual(payReturned.status, 409);

    const resend = await admin({ action: 'send_to_accounting', refund_codes: ['REF-T1'], note: 'Đã sửa STK theo khách xác nhận', actor: 'NV Lan' });
    assert.strictEqual(resend.data.sent, 1);
    const pay = await admin({ action: 'accounting_paid', refund_code: 'REF-T1', refund_ref: 'FT999', actor: 'KT Minh' });
    assert.strictEqual(pay.data.refund.status, 'PAID_OUT');
    const done = await admin({ action: 'confirm_done', refund_code: 'REF-T1' });
    assert.strictEqual(done.data.refund.status, 'DONE');
    const log = done.data.refund.review_log.map(l => l.action);
    assert.deepStrictEqual(log, ['Gửi Kế toán', 'Trả về nhân viên', 'Gửi lại Kế toán', 'Đạt – đã chi']);

    const ov = await call('admin', { headers: K, query: { action: 'overview' } });
    assert.ok(ov.data.refunds.some(r => r.code === 'REF-T2' && r.status === 'CS_APPROVED' && r.received > 0));
    assert.ok(ov.data.refunds.some(r => r.code === 'REF-T1' && r.status === 'DONE'));
  });

  for (const [ok, name] of results) console.log(ok, name);
  const failed = results.filter(r => r[0] === '✗').length;
  console.log(failed ? `\n${failed} kiểm thử LỖI` : `\nTất cả ${results.length} kiểm thử đều đạt`);
  process.exit(failed ? 1 : 0);
})();
