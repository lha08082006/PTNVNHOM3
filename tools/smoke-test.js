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

  // Đăng nhập nhân viên demo (chế độ bộ nhớ trong tự tạo 4 tài khoản, mật khẩu beta-admin)
  const staffLogin = async (email) => {
    const r = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email, password: 'beta-admin' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    return r.data.token;
  };
  const asStaff = (tok) => ({
    post: (body) => call('admin', { method: 'POST', token: tok, body }),
    get: (action) => call('admin', { token: tok, query: { action } })
  });

  await test('Nhân viên: đăng nhập riêng và phân quyền theo vai trò', async () => {
    const wrong = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'cskh@beta.local', password: 'sai' } });
    assert.strictEqual(wrong.status, 401);
    const anon = await call('admin', { query: { action: 'overview' } });
    assert.strictEqual(anon.status, 401);
    // Token khách hàng không dùng được cho trang nội bộ
    const customer = await call('admin', { token: tokB, query: { action: 'overview' } });
    assert.strictEqual(customer.status, 401);

    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const kt = asStaff(await staffLogin('ketoan@beta.local'));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    assert.strictEqual((await cs.get('overview')).status, 200);
    assert.strictEqual((await quay.get('overview')).status, 403);
    assert.strictEqual((await quay.get('staff_list')).status, 403);
    assert.strictEqual((await kt.get('staff_list')).status, 403);
    assert.strictEqual((await cs.post({ action: 'accounting_paid', refund_code: 'X', refund_ref: 'FT' })).status, 403);
    assert.strictEqual((await kt.post({ action: 'send_to_accounting', refund_codes: ['X'] })).status, 403);

    // Quản lý tạo nhân viên mới, khóa tài khoản thì phiên của người đó hết hiệu lực
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const created = await ql.post({ action: 'staff_create', full_name: 'NV Tam Thoi', email: 'tam@beta.local', role: 'CS', password: 'matkhau123' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.data));
    const r = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'tam@beta.local', password: 'matkhau123' } });
    const tam = asStaff(r.data.token);
    assert.strictEqual((await tam.get('me')).status, 200);
    await ql.post({ action: 'staff_update', id: created.data.staff.id, active: false });
    assert.strictEqual((await tam.get('me')).status, 401);
    const self = await ql.post({ action: 'staff_update', id: (await ql.get('me')).data.staff.id, active: false });
    assert.strictEqual(self.status, 400);
  });

  await test('Hoàn tiền thủ công: gửi Kế toán → trả về → gửi lại → chi → hoàn tất', async () => {
    const Store = require('../lib/store');
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const kt = asStaff(await staffLogin('ketoan@beta.local'));
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const order = await Store.one('orders', { code });
    const mk = async (c) => Store.insert('refunds', {
      code: c, order_id: order.id, order_code: code, amount: 50000, reason: 'MISMATCH', status: 'FORM_SUBMITTED',
      idempotency_key: 'test-' + c, deadline_at: new Date().toISOString(), is_manual: true,
      bank_name: 'MB Bank', acc_number: '0123456789', acc_name: 'KHACH A', receipt_url: 'data:image/png;base64,AA==', form_submitted_at: new Date().toISOString()
    });
    await mk('REF-T1'); await mk('REF-T2'); await mk('REF-T3');

    const sent = await cs.post({ action: 'send_to_accounting', refund_codes: ['REF-T1', 'REF-T2', 'REF-KHONGCO'] });
    assert.strictEqual(sent.data.sent, 2, JSON.stringify(sent.data));
    assert.strictEqual(sent.data.results.find(r => r.code === 'REF-KHONGCO').ok, false);

    const noReason = await kt.post({ action: 'accounting_reject', refund_code: 'REF-T1' });
    assert.strictEqual(noReason.status, 400);
    const rej = await kt.post({ action: 'accounting_reject', refund_code: 'REF-T1', reason: 'WRONG_ACCOUNT', note: 'STK sai 1 số' });
    assert.strictEqual(rej.status, 200, JSON.stringify(rej.data));
    assert.strictEqual(rej.data.refund.status, 'ACC_RETURNED');
    assert.strictEqual(rej.data.refund.returned_count, 1);
    // Hồ sơ đã trả về thì Kế toán không chi được nữa
    assert.strictEqual((await kt.post({ action: 'accounting_paid', refund_code: 'REF-T1', refund_ref: 'FT1' })).status, 409);

    const resend = await cs.post({ action: 'send_to_accounting', refund_codes: ['REF-T1'], note: 'Đã sửa STK theo khách xác nhận' });
    assert.strictEqual(resend.data.sent, 1);
    const pay = await kt.post({ action: 'accounting_paid', refund_code: 'REF-T1', refund_ref: 'FT999' });
    assert.strictEqual(pay.data.refund.status, 'PAID_OUT');
    const done = await cs.post({ action: 'confirm_done', refund_code: 'REF-T1' });
    assert.strictEqual(done.data.refund.status, 'DONE');
    const log = done.data.refund.review_log.map(l => `${l.action} (${l.actor})`);
    assert.deepStrictEqual(log, ['Gửi Kế toán (CSKH Demo)', 'Trả về nhân viên (Kế Toán Demo)', 'Gửi lại Kế toán (CSKH Demo)', 'Đạt – đã chi (Kế Toán Demo)']);

    // Nguyên tắc 2 người: Quản lý tự gửi thì không tự duyệt chi được
    await ql.post({ action: 'send_to_accounting', refund_codes: ['REF-T3'] });
    assert.strictEqual((await ql.post({ action: 'accounting_paid', refund_code: 'REF-T3', refund_ref: 'FT3' })).status, 403);
    assert.strictEqual((await kt.post({ action: 'accounting_paid', refund_code: 'REF-T3', refund_ref: 'FT3' })).status, 200);

    const ov = await cs.get('overview');
    assert.ok(ov.data.refunds.some(r => r.code === 'REF-T2' && r.status === 'CS_APPROVED' && r.received > 0));
    assert.ok(ov.data.refunds.some(r => r.code === 'REF-T1' && r.status === 'DONE'));

    // Mọi thao tác đều có trong nhật ký
    const au = await ql.get('audit');
    const acts = au.data.logs.map(l => l.action);
    for (const a of ['login', 'send_to_accounting', 'accounting_reject', 'accounting_paid', 'confirm_done', 'staff_create', 'staff_update']) assert.ok(acts.includes(a), 'thiếu nhật ký ' + a);
  });

  for (const [ok, name] of results) console.log(ok, name);
  const failed = results.filter(r => r[0] === '✗').length;
  console.log(failed ? `\n${failed} kiểm thử LỖI` : `\nTất cả ${results.length} kiểm thử đều đạt`);
  process.exit(failed ? 1 : 0);
})();
