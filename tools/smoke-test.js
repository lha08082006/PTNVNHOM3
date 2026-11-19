// tools/smoke-test.js - Kiểm thử nhanh toàn bộ luồng chính ở chế độ bộ nhớ trong (không đụng Supabase thật)
// Chạy: npm test
process.env.DB_MODE = 'mock';
delete process.env.ADMIN_KEY;
delete process.env.SEPAY_WEBHOOK_KEY;
delete process.env.AUTH_SECRET;

const assert = require('assert');
const api = (name) => require('../lib/routes/' + name);

// Gọi handler kiểu Vercel trong cùng tiến trình
async function call(name, { method = 'GET', query = {}, body = {}, token, headers = {} } = {}) {
  if (name === 'auth' && query.action === 'register' && body && !('accept_terms' in body)) body = { ...body, accept_terms: true };
  const req = { method, query, body, headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) } };
  let status = null;
  let data;
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    status(c) { status = c; return this; },
    json(d) { data = d; return this; },
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; }
  };
  await api(name)(req, res);
  return { status: status == null ? res.statusCode : status, data, headers: res.headers, body: res.body };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name + ' → ' + e.message]); }
}

(async () => {
  let tokA, tokB, code, ST;

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

  await test('Danh mục: lịch chiếu thật từ database', async () => {
    const mv = await call('catalog', { query: { action: 'movies' } });
    assert.ok(mv.data.movies.length >= 10);
    const r = await call('catalog', { query: { action: 'showtimes', days: 3 } });
    assert.ok(r.data.showtimes.length > 0);
    // Chọn suất còn xa giờ chiếu nhất để không bị "đã bắt đầu"
    ST = r.data.showtimes[r.data.showtimes.length - 1];
    assert.strictEqual(ST.seats_free, ST.seats_total);
    const one = await call('catalog', { query: { action: 'showtime', id: ST.id } });
    assert.strictEqual(one.data.showtime.id, ST.id);
    assert.strictEqual((await call('catalog', { query: { action: 'showtime', id: 'khong-co' } })).status, 404);
  });

  await test('Máy chủ tự tính giá, chặn sửa giá', async () => {
    const base = { showtime_id: ST.id };
    assert.strictEqual((await call('create-order', { method: 'POST', token: tokA, body: { showtime_id: 'sai', seats: ['A1'] } })).status, 400);
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
    const r = await call('create-order', { method: 'POST', token: tokB, body: { showtime_id: ST.id, seats: ['F2'] } });
    assert.strictEqual(r.status, 409);
    const after = await call('catalog', { query: { action: 'showtime', id: ST.id } });
    assert.strictEqual(after.data.showtime.seats_free, ST.seats_total - 3);
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
    const s = await call('order-status', { query: { code }, token: tokA }); // chủ đơn xem đầy đủ
    assert.strictEqual(s.data.status, 'CONFIRMED');
    assert.strictEqual(s.data.has_ticket, true);
    assert.strictEqual(s.data.customer_name, 'Khach A');
  });

  await test('Gửi lại vé qua email: chỉ chủ đơn, giới hạn số lần', async () => {
    const q = { action: 'resend-ticket', code };
    assert.strictEqual((await call('order-action', { method: 'POST', query: q })).status, 401);
    assert.strictEqual((await call('order-action', { method: 'POST', query: q, token: tokB })).status, 404); // đơn của người khác
    for (let i = 0; i < 3; i++) {
      const r = await call('order-action', { method: 'POST', query: q, token: tokA });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.match(r.data.email, /\*\*\*@/); // không trả lại email đầy đủ
    }
    assert.strictEqual((await call('order-action', { method: 'POST', query: q, token: tokA })).status, 429);
  });

  await test('Khách tự hủy đơn chờ thanh toán: nhả ghế ngay, không hủy được đơn đã có vé', async () => {
    const before = (await call('catalog', { query: { action: 'showtime', id: ST.id } })).data.showtime.seats_free;
    const r = await call('create-order', { method: 'POST', token: tokA, body: { showtime_id: ST.id, seats: ['B5', 'B6'] } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const held = (await call('catalog', { query: { action: 'showtime', id: ST.id } })).data.showtime.seats_free;
    assert.strictEqual(held, before - 2);
    const q = { action: 'cancel', code: r.data.code };
    assert.strictEqual((await call('order-action', { method: 'POST', query: q, token: tokB })).status, 404);
    const c = await call('order-action', { method: 'POST', query: q, token: tokA });
    assert.strictEqual(c.status, 200, JSON.stringify(c.data));
    assert.ok(['CANCELLED', 'EXPIRED'].includes(c.data.status), c.data.status);
    assert.strictEqual(c.data.has_ticket, false);
    const after = (await call('catalog', { query: { action: 'showtime', id: ST.id } })).data.showtime.seats_free;
    assert.strictEqual(after, before); // ghế đã nhả
    assert.strictEqual((await call('order-action', { method: 'POST', query: q, token: tokA })).status, 409); // hủy lại
    assert.strictEqual((await call('order-action', { method: 'POST', query: { action: 'cancel', code }, token: tokA })).status, 409); // đơn đã xuất vé
    // Người khác đặt lại được đúng ghế vừa nhả
    const again = await call('create-order', { method: 'POST', token: tokB, body: { showtime_id: ST.id, seats: ['B5'] } });
    assert.strictEqual(again.status, 200, JSON.stringify(again.data));
    await call('order-action', { method: 'POST', query: { action: 'cancel', code: again.data.code }, token: tokB });
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

  // --- Đối soát Tầng 2/3: tiền về muộn, ghế đã bán, gần giờ chiếu, thừa, trùng ---
  const Store = require('../lib/store');
  const sim = async (scenario, order_code, extra = {}) => {
    const r = await call('simulate-payment', { method: 'POST', body: { scenario, order_code, ...extra } });
    assert.strictEqual(r.status, 200, scenario + ': ' + JSON.stringify(r.data));
    return r.data.order;
  };
  const newOrder = async (seats) => {
    const r = await call('create-order', { method: 'POST', token: tokB, body: { showtime_id: ST.id, seats } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    return r.data.code;
  };
  const refundsOf = (c) => Store.find('refunds', { order_code: c });
  // Ngân hàng đã trừ tiền trong 10 phút nhưng cổng chỉ báo SUCCESS sau 12 phút, webhook thất lạc
  // -> hết giờ giữ ghế đơn thành EXPIRED (chưa rõ kết quả), chờ Job 30 phút đối soát.
  const paidButExpired = async (seats) => {
    const c = await newOrder(seats);
    await sim('SLOW_BANK', c, { delay_min: 12 });
    const o = await sim('SHIFT', c, { minutes: 11 });
    assert.strictEqual(o.status, 'EXPIRED', JSON.stringify(o));
    return c;
  };

  await test('Tầng 2: tiền về muộn, ghế còn trống -> cấp vé bù', async () => {
    const c = await paidButExpired(['B1']);
    const o = await sim('SHIFT', c, { minutes: 30 }); // tới chu kỳ Job 30 phút, cổng đã báo SUCCESS
    assert.strictEqual(o.status, 'CONFIRMED_LATE', JSON.stringify(o));
    assert.strictEqual((await refundsOf(c)).length, 0);
    const held = await Store.find('seat_holds', { showtime_key: (await Store.one('orders', { code: c })).showtime_key, seat_id: 'B1' }, { order: null });
    assert.strictEqual(held.length, 1);
    assert.strictEqual(held[0].status, 'SOLD');
  });

  await test('Tầng 2: ghế đã bán cho khách khác -> hoàn tiền SEAT_TAKEN', async () => {
    const c = await paidButExpired(['B2']);
    const other = await newOrder(['B2']); // ghế đã được nhả khi đơn hết hạn
    assert.strictEqual((await sim('OK', other)).status, 'CONFIRMED');
    const o = await sim('SHIFT', c, { minutes: 30 });
    assert.strictEqual(o.status, 'REFUNDED', JSON.stringify(o));
    const rf = await refundsOf(c);
    assert.strictEqual(rf.length, 1);
    assert.strictEqual(rf[0].reason, 'SEAT_TAKEN');
    assert.strictEqual(rf[0].status, 'DONE');
    assert.strictEqual(Number(rf[0].amount), Number((await Store.one('orders', { code: c })).total));
  });

  await test('Tầng 2: còn dưới 30 phút trước giờ chiếu -> hoàn tiền NEAR_SHOWTIME', async () => {
    const c = await paidButExpired(['B3']);
    await sim('SHOWTIME', c, { minutes: 20 });
    const o = await sim('SHIFT', c, { minutes: 30 });
    assert.strictEqual(o.status, 'REFUNDED', JSON.stringify(o));
    const rf = await refundsOf(c);
    assert.deepStrictEqual(rf.map(r => [r.reason, r.status]), [['NEAR_SHOWTIME', 'DONE']]);
  });

  await test('Tầng 2: chuyển tiền sau khi hết giờ giữ ghế -> hoàn tiền LATE', async () => {
    const c = await newOrder(['B4']);
    const o = await sim('LATE', c);
    assert.strictEqual(o.status, 'REFUNDED', JSON.stringify(o));
    assert.deepStrictEqual((await refundsOf(c)).map(r => r.reason), ['LATE']);
  });

  await test('Khách đã hủy đơn rồi vẫn chuyển tiền -> cấp vé bù hoặc tự hoàn, không mất tiền', async () => {
    const cancel = async (c) => {
      const x = await call('order-action', { method: 'POST', query: { action: 'cancel', code: c }, token: tokB });
      assert.strictEqual(x.status, 200, JSON.stringify(x.data));
    };
    // Chuyển đủ ngay trong 10 phút giữ ghế ban đầu, ghế còn trống -> cấp vé bù ("Cứu vé trước")
    const c1 = await newOrder(['B7']);
    await cancel(c1);
    const o1 = await sim('LATE', c1);
    assert.strictEqual(o1.status, 'CONFIRMED_LATE', JSON.stringify(o1.history));
    assert.strictEqual(o1.has_ticket, true);
    // Ghế đã bị người khác mua sau khi hủy -> hoàn tiền ("Hoàn tiền sau")
    const c2 = await newOrder(['B8']);
    await cancel(c2);
    await sim('SEAT_TAKEN', c2);
    await sim('LATE', c2);
    const o2 = (await call('order-status', { query: { code: c2 } })).data;
    assert.ok(['REFUNDED', 'REFUND_REQUESTED'].includes(o2.status), o2.status);
    assert.strictEqual((await refundsOf(c2)).length, 1);
  });

  await test('Chuyển thừa -> xuất vé + hoàn phần thừa; webhook trùng không xử lý lại', async () => {
    const c = await newOrder(['B5']);
    const o = await sim('EXCESS', c, { custom_amount: 0 });
    assert.strictEqual(o.status, 'CONFIRMED', JSON.stringify(o));
    let rf = await refundsOf(c);
    assert.deepStrictEqual(rf.map(r => [r.reason, Number(r.amount), r.status]), [['EXCESS', 21000, 'DONE']]);

    // SePay gửi lại đúng webhook cũ (2 lần): không thêm giao dịch, vé hay lệnh hoàn
    for (let i = 0; i < 2; i++) {
      const r = await call('simulate-payment', { method: 'POST', body: { scenario: 'DUP_WEBHOOK', order_code: c } });
      assert.strictEqual(r.data.webhook.duplicate, true, JSON.stringify(r.data));
    }
    assert.strictEqual((await Store.find('bank_transactions', { code: c })).length, 1);
    assert.strictEqual((await refundsOf(c)).length, 1);
    const after = await Store.one('orders', { code: c });
    assert.strictEqual(after.status, 'CONFIRMED');
    assert.strictEqual(after.history.filter(h => h.from !== 'CONFIRMED' && h.to === 'CONFIRMED').length, 1); // xuất vé đúng một lần

    // Khách chuyển thêm một giao dịch MỚI cho đơn đã xuất vé -> hoàn toàn bộ khoản đó (DUPLICATE)
    await sim('OK', c, { custom_amount: after.total });
    rf = await refundsOf(c);
    const dup = rf.filter(r => r.reason === 'DUPLICATE');
    assert.strictEqual(dup.length, 1);
    assert.strictEqual(Number(dup[0].amount), Number(after.total));
    assert.strictEqual(dup[0].status, 'DONE');
    assert.strictEqual((await Store.one('orders', { code: c })).status, 'CONFIRMED');
  });

  // Đăng nhập nhân viên demo (chế độ bộ nhớ trong tự tạo 4 tài khoản, mật khẩu beta-admin)
  const staffLogin = async (email) => {
    const r = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email, password: 'beta-admin' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    return r.data.token;
  };
  const asStaff = (tok) => ({
    token: tok,
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

  await test('Danh mục (Quản lý): tạo phim, suất chiếu, voucher giới hạn lượt', async () => {
    const CatalogDB = require('../lib/catalog-db');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    assert.strictEqual((await cs.post({ action: 'movie_save', title: 'Phim Cam' })).status, 403);
    const mv = await ql.post({ action: 'movie_save', title: 'Phim Thử Nghiệm', age: 'T13', duration_min: 100, status: 'NOW' });
    assert.strictEqual(mv.status, 200, JSON.stringify(mv.data));
    assert.strictEqual(mv.data.movie.id, 'phim-thu-nghiem');
    // Suất chiếu 90 phút nữa (giờ VN), giá riêng
    const soon = CatalogDB.vnParts(new Date(Date.now() + 90 * 60000).toISOString());
    const sc = await ql.post({ action: 'showtime_create', movie_id: 'phim-thu-nghiem', cinema_id: 'beta-thanh-xuan', date: soon.date, times: soon.time, price_standard: 60000 });
    assert.strictEqual(sc.data.created, 1, JSON.stringify(sc.data));
    const dup = await ql.post({ action: 'showtime_create', movie_id: 'phim-thu-nghiem', cinema_id: 'beta-thanh-xuan', date: soon.date, times: soon.time });
    assert.strictEqual(dup.data.created, 0);
    const list = await call('catalog', { query: { action: 'showtimes', movie: 'phim-thu-nghiem', date: soon.date } });
    globalThis.SOON = list.data.showtimes[0];
    assert.strictEqual(SOON.prices.standard, 60000);

    // Voucher 1 lượt / khách, tối đa 2 lượt
    await ql.post({ action: 'voucher_save', code: 'THU2', discount: 10000, max_uses: 2, per_customer: 1 });
    const v1 = await call('create-order', { method: 'POST', token: tokB, body: { showtime_id: SOON.id, seats: ['A1'], voucher: 'thu2', total: 50000 } });
    assert.strictEqual(v1.status, 200, JSON.stringify(v1.data));
    globalThis.SOON_CODE = v1.data.code;
    const again = await call('create-order', { method: 'POST', token: tokB, body: { showtime_id: SOON.id, seats: ['A2'], voucher: 'THU2' } });
    assert.strictEqual(again.status, 400); // đã dùng 1 lượt
    const check = await call('catalog', { token: tokB, query: { action: 'voucher', code: 'THU2' } });
    assert.strictEqual(check.status, 400);
    // Không ngừng bán suất đã có khách giữ ghế
    assert.strictEqual((await ql.post({ action: 'showtime_update', id: SOON.id, active: false })).status, 409);
  });

  await test('Soát vé QR: hợp lệ một lần, chặn vé giả và vé đã soát', async () => {
    const quay = asStaff(await staffLogin('quay@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    // Đơn chưa thanh toán thì không soát được
    const unpaid = await quay.post({ action: 'checkin', qr: SOON_CODE });
    assert.strictEqual(unpaid.status, 409);
    await call('simulate-payment', { method: 'POST', body: { scenario: 'OK', order_code: SOON_CODE } });
    const view = await call('order-status', { query: { code: SOON_CODE }, token: tokB }); // chủ vé mới thấy mã QR
    assert.match(view.data.ticket_qr, /^BETA1\.BC\d{10}\.[A-Za-z0-9_-]{16}$/);
    assert.strictEqual((await cs.post({ action: 'checkin', qr: view.data.ticket_qr })).status, 403);
    const forged = await quay.post({ action: 'checkin', qr: view.data.ticket_qr.slice(0, -2) + 'xx' });
    assert.strictEqual(forged.status, 400);
    const ok = await quay.post({ action: 'checkin', qr: view.data.ticket_qr });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.deepStrictEqual(ok.data.summary.seats, ['A1']);
    const twice = await quay.post({ action: 'checkin', qr: view.data.ticket_qr });
    assert.strictEqual(twice.status, 409);
    assert.strictEqual(twice.data.already, true);
    const byCode = await quay.post({ action: 'checkin', code: SOON_CODE });
    assert.strictEqual(byCode.status, 409);
    // Vé của suất còn xa (hơn 2 giờ) thì chưa mở soát
    const far = await quay.post({ action: 'checkin', code });
    assert.strictEqual(far.status, 409);
    assert.ok((await call('order-status', { query: { code: SOON_CODE } })).data.checked_in_at);
  });

  await test('Nhật ký: mỗi thao tác ghi thành công tạo đúng 1 dòng, lỗi ghi không bị nuốt', async () => {
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    const logs = () => Store.find('audit_logs', {}, { limit: 10000 });
    // Mỗi phản hồi trả về khi nhật ký đã ghi xong (không ghi "chạy ngầm" sau phản hồi)
    const expectOne = async (who, body) => {
      const before = (await logs()).length;
      const r = await who.post(body);
      assert.strictEqual(r.status, 200, body.action + ': ' + JSON.stringify(r.data));
      const after = await logs();
      assert.strictEqual(after.length, before + 1, 'số dòng nhật ký sau ' + body.action);
      assert.ok(after.some(l => l.action === body.action), 'thiếu nhật ký ' + body.action);
      assert.strictEqual(r.data.audit_warning, undefined);
    };
    await expectOne(ql, { action: 'movie_save', title: 'Phim Nhật Ký', status: 'SOON' });
    await expectOne(ql, { action: 'cinema_save', id: 'beta-thanh-xuan', name: 'Beta Thanh Xuân' });
    await expectOne(ql, { action: 'voucher_save', code: 'NHATKY', discount: 5000, max_uses: 1 });
    await expectOne(ql, { action: 'staff_create', full_name: 'NV Nhat Ky', email: 'nhatky@beta.local', role: 'COUNTER', password: 'matkhau123' });
    await expectOne(ql, { action: 'run_job' });
    await expectOne(cs, { action: 'send_to_accounting', refund_codes: ['REF-T2'] });

    // Thao tác bị từ chối (sai quyền / lỗi nghiệp vụ) không ghi nhật ký
    const before = (await logs()).length;
    assert.strictEqual((await cs.post({ action: 'movie_save', title: 'Cam' })).status, 403);
    assert.strictEqual((await quay.post({ action: 'checkin', code })).status, 409);
    assert.strictEqual((await logs()).length, before);

    // DB lỗi khi ghi nhật ký -> thao tác vẫn xong nhưng phản hồi có cảnh báo
    const insert = Store.insert;
    const errLog = console.error;
    const errs = [];
    Store.insert = async (table, row) => { if (table === 'audit_logs') throw new Error('mất kết nối'); return insert.call(Store, table, row); };
    console.error = (...a) => errs.push(a.join(' '));
    try {
      const r = await ql.post({ action: 'movie_save', title: 'Phim Nhật Ký', status: 'NOW' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.match(r.data.audit_warning || '', /chưa ghi được nhật ký/);
      assert.ok(errs.some(e => e.includes('movie_save')), 'không có log lỗi phía máy chủ');
    } finally { Store.insert = insert; console.error = errLog; }
  });

  await test('Tổng quan: doanh thu, vé bán, lấp đầy', async () => {
    const kt = asStaff(await staffLogin('ketoan@beta.local'));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    assert.strictEqual((await quay.get('dashboard')).status, 403);
    const d = await kt.get('dashboard');
    assert.strictEqual(d.status, 200, JSON.stringify(d.data));
    assert.ok(d.data.kpi.revenue >= 264000 + 50000);
    assert.ok(d.data.kpi.tickets >= 4);
    assert.strictEqual(d.data.days.length, 14);
    assert.ok(d.data.by_movie.length >= 2);
    assert.ok(d.data.upcoming.some(x => x.sold > 0));
  });

  await test('Quên mật khẩu bằng mã OTP + khóa khi đăng nhập sai nhiều lần', async () => {
    for (let i = 0; i < 5; i++) await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: 'b@test.vn', password: 'sai-' + i } });
    const locked = await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: 'b@test.vn', password: 'matkhau123' } });
    assert.strictEqual(locked.status, 429); // đúng mật khẩu nhưng đang bị khóa
    const unknown = await call('auth', { method: 'POST', query: { action: 'forgot' }, body: { email: 'khongco@test.vn' } });
    assert.strictEqual(unknown.status, 200);
    assert.strictEqual(unknown.data.dev_code, undefined); // không lộ email chưa đăng ký
    const f = await call('auth', { method: 'POST', query: { action: 'forgot' }, body: { email: 'b@test.vn' } });
    assert.match(f.data.dev_code, /^\d{6}$/);
    const wrong = await call('auth', { method: 'POST', query: { action: 'reset' }, body: { email: 'b@test.vn', code: '000000' === f.data.dev_code ? '111111' : '000000', new_password: 'matkhaumoi9' } });
    assert.strictEqual(wrong.status, 400);
    const r = await call('auth', { method: 'POST', query: { action: 'reset' }, body: { email: 'b@test.vn', code: f.data.dev_code, new_password: 'matkhaumoi9' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual((await call('auth', { query: { action: 'me' }, token: tokB })).status, 401); // phiên cũ hết hạn
    const reuse = await call('auth', { method: 'POST', query: { action: 'reset' }, body: { email: 'b@test.vn', code: f.data.dev_code, new_password: 'matkhaukhac1' } });
    assert.strictEqual(reuse.status, 400); // mã chỉ dùng một lần
    const login = await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: 'b@test.vn', password: 'matkhaumoi9' } });
    assert.strictEqual(login.status, 200); // đặt lại mật khẩu cũng mở khóa đăng nhập
    // Nhân viên cũng bị khóa khi sai nhiều lần
    for (let i = 0; i < 5; i++) await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'quay@beta.local', password: 'sai' } });
    assert.strictEqual((await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'quay@beta.local', password: 'beta-admin' } })).status, 429);
  });

  await test('Chỉ biết mã đơn thì không xem được thông tin cá nhân / mã QR, không khai được tài khoản nhận hoàn', async () => {
    const Store = require('../lib/store');
    const login = async (l, p) => (await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: l, password: p } })).data.token;
    const tokA2 = await login('a@test.vn', 'matkhaumoi1');
    const tokB = await login('b@test.vn', 'matkhaumoi9');
    assert.ok(tokA2 && tokB, 'không đăng nhập lại được tài khoản test');
    // Người lạ (không đăng nhập) và khách khác (tokB) chỉ thấy trạng thái
    for (const tok of [undefined, tokB]) {
      const v = (await call('order-status', { query: { code }, token: tok })).data;
      assert.strictEqual(v.limited, true);
      for (const k of ['phone', 'email', 'customer_name', 'ticket_qr', 'history', 'notifications']) assert.strictEqual(v[k], undefined, k + ' bị lộ');
      assert.ok(v.status && v.code === code);
    }
    const g = await call('orders', { query: { codes: code } });
    assert.strictEqual(g.data.orders[0].ticket_qr, undefined);
    assert.strictEqual(g.data.orders[0].email, undefined);
    const rep = await call('report-issue', { method: 'POST', body: { order_code: code } });
    assert.strictEqual(rep.data.phone, undefined);
    const rec = await call('reconcile', { method: 'POST', body: { order_code: code } });
    assert.strictEqual(rec.data.order.ticket_qr, undefined);
    // Chủ đơn và nhân viên vẫn xem đầy đủ
    const own = (await call('order-status', { query: { code }, token: tokA2 })).data;
    assert.ok(own.ticket_qr && own.email && !own.limited);
    const cs = await staffLogin('cskh@beta.local');
    assert.ok((await call('order-status', { query: { code }, token: cs })).data.ticket_qr);

    // Form nhận hoàn tiền: chỉ chủ đơn
    const order = await Store.one('orders', { code });
    await Store.insert('refunds', { code: 'REF-ACC1', order_id: order.id, order_code: code, amount: 10000, reason: 'MISMATCH', status: 'MANUAL_REVIEW',
      idempotency_key: 'test-acc1', deadline_at: new Date().toISOString(), is_manual: true });
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const form = { order_code: code, bank_name: 'MB', acc_number: '0123456789', acc_name: 'KE GIAN', receipt: PNG };
    assert.strictEqual((await call('refund', { method: 'POST', body: form })).status, 401);
    assert.strictEqual((await call('refund', { method: 'POST', body: form, token: tokB })).status, 404);
    const ok = await call('refund', { method: 'POST', body: { ...form, acc_name: 'KHACH A' }, token: tokA2 });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
  });

  // ===================== Đợt 1 =====================
  await test('Đợt 1: giá theo ngày / khung giờ, Quản lý đổi giá là áp dụng ngay', async () => {
    const CatalogDB = require('../lib/catalog-db');
    const all = (await call('catalog', { query: { action: 'showtimes', days: 14 } })).data.showtimes;
    const pr = await CatalogDB.pricing();
    // Mỗi suất: giá trả về đúng bằng giá tính lại từ quy tắc
    for (const s of all.slice(0, 200).filter(x => !x.prices.rules.includes('Giá riêng của suất'))) {
      const p = CatalogDB.priceOf({ starts_at: s.starts_at }, pr);
      assert.strictEqual(s.prices.standard, p.standard, s.date_label + ' ' + s.time);
    }
    const norm = all.filter(x => !x.prices.rules.includes('Giá riêng của suất'));
    const weekend = norm.find(s => /^(T6|T7|CN)/.test(s.date_label) && s.time >= '10:00' && s.time < '22:00');
    const tuesday = norm.find(s => /^T3/.test(s.date_label));
    const early = norm.find(s => s.time < '10:00' && !/^T3/.test(s.date_label));
    if (weekend) assert.strictEqual(weekend.prices.standard, 55000);
    if (tuesday) assert.strictEqual(tuesday.prices.standard, 40000);
    if (early) assert.strictEqual(early.prices.standard, 40000);
    assert.ok(all.every(s => !s.movie || !s.movie.duration_min || /^\d\d:\d\d$/.test(s.end_time)), 'thiếu giờ kết thúc');

    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    assert.strictEqual((await cs.post({ action: 'price_rule_save', name: 'X', days: [1], price_standard: 1 })).status, 403);
    // Ngày lễ: thêm ngày của một suất -> suất đó tính giá lễ
    const target = all.find(s => s.time >= '10:00' && s.time < '22:00' && !/^T3/.test(s.date_label));
    assert.strictEqual((await ql.post({ action: 'holiday_save', date: target.date, name: 'Ngày lễ thử' })).status, 200);
    const after = (await call('catalog', { query: { action: 'showtime', id: target.id } })).data.showtime;
    assert.strictEqual(after.prices.standard, 65000);
    assert.strictEqual(after.prices.holiday, 'Ngày lễ thử');
    await ql.post({ action: 'holiday_delete', date: target.date });
    const bad = await ql.post({ action: 'price_rule_save', name: 'Sai giờ', days: [1], start_time: '23:00', end_time: '10:00', price_standard: 1000 });
    assert.strictEqual(bad.status, 400);
    const pub = (await call('catalog', { query: { action: 'pricing' } })).data;
    assert.ok(pub.rules.length >= 6 && pub.ticket_types.STUDENT.off === 10000);
  });

  await test('Đợt 1: vé HSSV / trẻ em – máy chủ tính đúng, lưu loại vé & giá từng ghế, quầy được nhắc', async () => {
    const login = async (l, p) => (await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: l, password: p } })).data.token;
    const tok = await login('a@test.vn', 'matkhaumoi1');
    const st = (await call('catalog', { query: { action: 'showtimes', days: 3 } })).data.showtimes.slice(-3)[0];
    const P = st.prices;
    // 2 ghế thường + 1 ghế đôi; 1 HSSV + 1 trẻ em
    const body = { showtime_id: st.id, seats: ['D7', 'D8', 'H7-H8'], ticket_types: { STUDENT: 1, CHILD: 1 } };
    const expect = (P.standard - 10000) + (P.standard - 15000) + P.sweetbox;
    const wrong = await call('create-order', { method: 'POST', token: tok, body: { ...body, total: P.standard * 2 + P.sweetbox } });
    assert.strictEqual(wrong.status, 409); // trình duyệt tự tính sai -> bị chặn
    const tooMany = await call('create-order', { method: 'POST', token: tok, body: { ...body, ticket_types: { CHILD: 3 } } });
    assert.strictEqual(tooMany.status, 400); // vượt số ghế thường/VIP
    const r = await call('create-order', { method: 'POST', token: tok, body: { ...body, total: expect } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.total, expect);
    assert.deepStrictEqual(Object.values(r.data.ticket_types).sort(), ['CHILD', 'COUPLE', 'STUDENT']);
    assert.strictEqual(Object.values(r.data.seat_prices).reduce((a, b) => a + b, 0), expect);
    // Soát vé: nhắc kiểm tra giấy tờ đúng 2 ghế
    const Store = require('../lib/store');
    const o = await Store.one('orders', { code: r.data.code });
    await Store.update('orders', { id: o.id }, { status: 'CONFIRMED', show_at: new Date(Date.now() + 30 * 60000).toISOString() });
    const quay = asStaff(await staffLogin('quay@beta.local').catch(() => null) || (await staffLogin('quanly@beta.local')));
    const ck = await quay.post({ action: 'checkin', code: r.data.code });
    assert.strictEqual(ck.status, 200, JSON.stringify(ck.data));
    assert.deepStrictEqual(ck.data.summary.special.map(x => x.code).sort(), ['CHILD', 'STUDENT']);
  });

  await test('Đợt 1: thông tin phim chi tiết, tọa độ rạp', async () => {
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const r = await ql.post({ action: 'movie_save', id: 'suzume', title: 'KHÓA CHẶT CỬA NÀO SUZUME', age: 'P', status: 'NOW', director: 'Makoto Shinkai',
      cast: 'Nanoka Hara, Hokuto Matsumura', release_date: '2026-11-01', genre: 'Hoạt hình, Phiêu lưu', synopsis: 'Đoạn 1.\n\nĐoạn 2.' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const m = (await call('catalog', { query: { action: 'movies' } })).data.movies.find(x => x.key === 'suzume');
    assert.strictEqual(m.director, 'Makoto Shinkai');
    assert.strictEqual(m.release_date, '2026-11-01');
    assert.ok(m.age_note.includes('mọi độ tuổi'));
    const c = (await call('catalog', { query: { action: 'cinemas' } })).data.cinemas;
    assert.ok(c.filter(x => x.lat != null && x.lng != null).length >= 9);
    assert.strictEqual((await ql.post({ action: 'cinema_save', id: 'beta-my-dinh', name: 'Beta Mỹ Đình', lat: 999 })).status, 400);
  });

  await test('Đợt 1: tin tức & ưu đãi – bản nháp không hiện, hết hạn không hiện, chặn ảnh lạ', async () => {
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const pub = (await call('catalog', { query: { action: 'posts' } })).data;
    assert.ok(pub.posts.length >= 3 && pub.posts[0].pinned, 'bài ghim phải lên đầu');
    const draft = await ql.post({ action: 'post_save', title: 'Bài nháp bí mật', type: 'NEWS', published: false, body: 'x' });
    assert.strictEqual(draft.status, 200);
    const expired = await ql.post({ action: 'post_save', title: 'Ưu đãi đã hết', type: 'PROMO', published: true, ends_at: new Date(Date.now() - 3600e3).toISOString() });
    const forMovie = await ql.post({ action: 'post_save', title: 'Ưu đãi riêng phim Suzume', type: 'PROMO', published: true, movie_id: 'suzume' });
    const list = (await call('catalog', { query: { action: 'posts', limit: 50 } })).data.posts.map(p => p.id);
    assert.ok(!list.includes(draft.data.post.id) && !list.includes(expired.data.post.id));
    assert.strictEqual((await call('catalog', { query: { action: 'post', id: draft.data.post.id } })).status, 404);
    const sz = (await call('catalog', { query: { action: 'posts', movie: 'suzume', type: 'PROMO' } })).data.posts.map(p => p.id);
    const other = (await call('catalog', { query: { action: 'posts', movie: 'me-min', type: 'PROMO' } })).data.posts.map(p => p.id);
    assert.ok(sz.includes(forMovie.data.post.id) && !other.includes(forMovie.data.post.id));
    assert.strictEqual((await ql.post({ action: 'post_save', title: 'Ảnh độc hại', type: 'NEWS', image: 'javascript:alert(1)' })).status, 400);
    assert.strictEqual((await call('admin', { query: { action: 'post_list' } })).status, 401);
  });

  // Khách mới cho các kiểm thử hợp nhất (token cũ có thể đã hết hạn do đổi / quên mật khẩu)
  const newCustomer = async (n) => (await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khach ' + n, email: n + '@hopnhat.vn', phone: '09020000' + String(n.length).padStart(2, '0') + n.charCodeAt(0) % 10, password: 'matkhau123' } })).data.token;
  const tokC = await newCustomer('c'), tokD = await newCustomer('dd');

  await test('Hợp nhất GitHub: voucher có điều kiện (đơn tối thiểu, kèm combo, theo thứ, giảm %)', async () => {
    const Catalog = require('../catalog');
    const vd = Catalog.voucherDiscount;
    assert.strictEqual(vd('P', { kind: 'PERCENT', percent: 20, max_discount: 50000 }, { base: 100000 }), 20000);
    assert.strictEqual(vd('P', { kind: 'PERCENT', percent: 20, max_discount: 50000 }, { base: 400000 }), 50000);
    assert.strictEqual(vd('S', { kind: 'PER_SEAT', discount: 10000 }, { base: 200000, seat_count: 3 }), 30000);
    assert.throws(() => vd('N', { discount: 50000, min_total: 150000 }, { base: 90000 }), /150\.000/);
    assert.throws(() => vd('C', { discount: 30000, need_combo: true }, { base: 90000, combo_total: 0 }), /bắp nước/);
    assert.throws(() => vd('T', { kind: 'PERCENT', percent: 15, weekdays: [2] }, { base: 90000, show_dow: 3 }), /thứ Ba/);

    // Máy chủ: kiểm tra điều kiện theo suất chiếu thật
    const dowOf = (s) => new Date(new Date(s.starts_at).getTime() + 7 * 3600e3).getUTCDay();
    const all = (await call('catalog', { query: { action: 'showtimes', days: 7 } })).data.showtimes.filter(s => new Date(s.starts_at) > Date.now() + 3600e3);
    const notTue = all.filter(s => dowOf(s) !== 2).pop();
    const tue = all.filter(s => dowOf(s) === 2).pop();
    const free = Catalog.SEAT_IDS.filter(id => Catalog.seatType(id) === 'standard').slice(-6);
    const order = (st, seats, extra) => call('create-order', { method: 'POST', token: tokC, body: { showtime_id: st.id, seats, ...extra } });
    const noCombo = await order(notTue, [free[0]], { voucher: 'COMBO30' });
    assert.strictEqual(noCombo.status, 400);
    assert.ok(/bắp nước/.test(noCombo.data.error), noCombo.data.error);
    const withCombo = await order(notTue, [free[0]], { voucher: 'combo30', combos: { couple: 1 } });
    assert.strictEqual(withCombo.status, 200, JSON.stringify(withCombo.data));
    assert.strictEqual(withCombo.data.discount !== undefined ? withCombo.data.discount : 30000, 30000);
    const wrongDay = await order(notTue, [free[1]], { voucher: 'T3VUIVE' });
    assert.strictEqual(wrongDay.status, 400);
    assert.ok(/thứ Ba/.test(wrongDay.data.error));
    if (tue) {
      const ok = await order(tue, [free[2], free[3]], { voucher: 'T3VUIVE' });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    }
    const small = await order(notTue, [free[4]], { voucher: 'NEWMEMBER' });
    assert.strictEqual(small.status, 400); // đơn dưới 150.000 đ

    // Quản lý tạo voucher giảm % chỉ cuối tuần
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    assert.strictEqual((await ql.post({ action: 'voucher_save', code: 'SAIPHAN', kind: 'PERCENT', percent: 150 })).status, 400);
    const sv = await ql.post({ action: 'voucher_save', code: 'CUOITUAN', kind: 'PERCENT', percent: 10, max_discount: 30000, weekdays: [0, 6] });
    assert.strictEqual(sv.status, 200, JSON.stringify(sv.data));
    assert.deepStrictEqual(sv.data.voucher.weekdays, [0, 6]);
    const ck = await call('catalog', { token: tokC, query: { action: 'voucher', code: 'cuoituan' } });
    const thu2 = await ql.post({ action: 'voucher_save', code: 'MOINGAY', discount: 5000 });
    assert.deepStrictEqual(thu2.data.voucher.weekdays, [], 'không chọn thứ = mọi ngày');
    assert.strictEqual(ck.data.voucher.kind, 'PERCENT');
    assert.strictEqual(ck.data.voucher.percent, 10);
  });

  await test('Hợp nhất GitHub: khách xem & trả lời phản hồi CSKH trên phiếu hỗ trợ', async () => {
    assert.strictEqual((await call('support')).status, 401);
    const sent = await call('support', { method: 'POST', token: tokC, body: { category: 'SERVICE', phone: '0902000003', description: 'Phòng chiếu số 3 quá lạnh' } });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.data));
    const code = sent.data.ticket_code;
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const rep = await cs.post({ action: 'ticket_reply', ticket_code: code, message: 'Rạp đã chỉnh nhiệt độ, cảm ơn bạn.' });
    assert.strictEqual(rep.status, 200, JSON.stringify(rep.data));
    const mine = await call('support', { token: tokC });
    const t = mine.data.tickets.find(x => x.code === code);
    assert.strictEqual(t.status, 'WAITING_CUSTOMER');
    assert.strictEqual(t.replies[0].name, 'CSKH Beta');
    assert.ok(!('note' in t) && !('context' in t), 'không lộ dữ liệu nội bộ');
    assert.strictEqual((await call('support', { token: tokD })).data.tickets.some(x => x.code === code), false);
    assert.strictEqual((await call('support', { method: 'POST', token: tokD, query: { action: 'reply' }, body: { ticket_code: code, message: 'chen ngang' } })).status, 404);
    const back = await call('support', { method: 'POST', token: tokC, query: { action: 'reply' }, body: { ticket_code: code, message: 'Cảm ơn rạp!' } });
    assert.strictEqual(back.status, 200);
    assert.strictEqual(back.data.ticket.status, 'OPEN');
    assert.strictEqual(back.data.ticket.replies.length, 2);
  });

  // ======================= Đợt 2: Beta Club, đánh giá phim, PWA, bắp nước, thư nhắc =======================
  const tokE = await newCustomer('eee');
  await require('../lib/throttle').reset('s:quay@beta.local'); // kiểm thử trước đã cố tình khóa tài khoản quầy
  const payOK = async (c) => { const r = await call('simulate-payment', { method: 'POST', body: { scenario: 'OK', order_code: c } }); assert.strictEqual(r.status, 200, JSON.stringify(r.data)); };
  const freeSeats = async (st, n) => {
    const taken = new Set((await call('seats', { query: { showtime_key: st.id } })).data.seats.map(x => x.seat));
    return require('../catalog').SEAT_IDS.filter(id => require('../catalog').seatType(id) === 'standard' && !taken.has(id)).slice(0, n);
  };
  const ST2 = (await call('catalog', { query: { action: 'showtimes', days: 7 } })).data.showtimes.filter(s => new Date(s.starts_at) > Date.now() + 3 * 3600e3).pop();

  await test('Đợt 2: Beta Club – tích điểm khi xuất vé, dùng điểm tối đa 50%, hoàn điểm khi đơn hủy', async () => {
    const Points = require('../lib/points');
    const me = (await call('auth', { token: tokE, query: { action: 'me' } })).data.user;
    const seats = await freeSeats(ST2, 4);
    const o1 = await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: ST2.id, seats: seats.slice(0, 2), combos: { couple: 1 } } });
    assert.strictEqual(o1.status, 200, JSON.stringify(o1.data));
    await payOK(o1.data.code);
    const v1 = (await call('order-status', { token: tokE, query: { code: o1.data.code } })).data;
    // Hạng Thành viên: 5% tiền vé + 3% bắp nước, làm tròn xuống theo 1.000 đ
    const seatT = Object.values(v1.seat_prices).reduce((s, x) => s + x, 0);
    assert.strictEqual(v1.points_earned, Math.floor((seatT * 0.05 + 89000 * 0.03) / 1000));
    await payOK(o1.data.code); // webhook trùng không cộng lại
    let p = (await call('member', { token: tokE, query: { action: 'points' } })).data;
    assert.strictEqual(p.balance, v1.points_earned);
    assert.strictEqual(p.tier.id, 'MEMBER');
    // Cộng thêm điểm để thử dùng điểm
    await require('../lib/store').insert('point_ledger', { ref: 'ADJ:test:' + me.id, customer_id: me.id, kind: 'ADJUST', points: 200, expires_at: new Date(Date.now() + 90 * 864e5).toISOString() });
    const have = await Points.balance(me.id);
    // Vượt 50% giá trị đơn -> từ chối
    const tooMany = await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: ST2.id, seats: [seats[2]], points: 100 } });
    assert.strictEqual(tooMany.status, 400);
    assert.ok(/tối đa/.test(tooMany.data.error), tooMany.data.error);
    const used = Math.floor(ST2.prices.standard * 0.5 / 1000);
    const o2 = await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: ST2.id, seats: [seats[2]], points: used, total: ST2.prices.standard - used * 1000 } });
    assert.strictEqual(o2.status, 200, JSON.stringify(o2.data));
    assert.strictEqual(o2.data.points_used, used);
    assert.strictEqual(await Points.balance(me.id), have - used);
    // Khách hủy đơn chưa thanh toán -> trả lại điểm (một lần)
    const cancel = await call('order-action', { method: 'POST', token: tokE, query: { action: 'cancel', code: o2.data.code } });
    assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.data));
    assert.strictEqual(await Points.balance(me.id), have);
    // Không đủ điểm
    const poor = await call('create-order', { method: 'POST', token: tokC, body: { showtime_id: ST2.id, seats: [seats[3]], points: 5 } });
    assert.strictEqual(poor.status, 400);
    p = (await call('member', { token: tokE, query: { action: 'points' } })).data;
    assert.ok(p.history.some(h => h.kind === 'RETURN') && p.history.some(h => h.kind === 'REDEEM'));
    assert.strictEqual((await call('member', { query: { action: 'points' } })).status, 401);
  });

  await test('Đợt 2: điểm hết hạn (dùng điểm sắp hết hạn trước), quà sinh nhật, hạng VIP', async () => {
    const Points = require('../lib/points');
    const Catalog = require('../catalog');
    const day = 864e5, now = Date.now();
    const rows = [
      { points: 100, expires_at: new Date(now - day).toISOString() },      // đã hết hạn
      { points: 50, expires_at: new Date(now + 10 * day).toISOString() },  // sắp hết hạn
      { points: 70, expires_at: new Date(now + 200 * day).toISOString() },
      { points: -120 }                                                      // đã dùng 120
    ];
    // 120 điểm đã dùng trừ vào 100 (hết hạn) + 20 (sắp hết hạn) -> không mất điểm nào, còn 30 sắp hết hạn
    assert.deepStrictEqual(Points.summarize(rows, new Date(now)), { balance: 100, pendingExpire: 0, expiringSoon: 30 });
    assert.deepStrictEqual(Points.summarize(rows.slice(0, 3), new Date(now)), { balance: 120, pendingExpire: 100, expiringSoon: 50 });
    assert.strictEqual(Catalog.tierOf(1999999).id, 'MEMBER');
    assert.strictEqual(Catalog.tierOf(2000000).id, 'VIP');
    assert.strictEqual(Catalog.tierOf(9e9).id, 'VVIP');
    // Sinh nhật trong tháng này -> cộng quà đúng 1 lần / năm
    const vnMonth = new Date(Date.now() + 7 * 3600e3).toISOString().slice(5, 7);
    const t = (await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Sinh Nhat', email: 'sn@hopnhat.vn', phone: '0909111222', password: 'matkhau123', birthday: '2000-' + vnMonth + '-15' } })).data.token;
    await Points.daily();
    await Points.daily();
    const p = (await call('member', { token: t, query: { action: 'points' } })).data;
    assert.strictEqual(p.balance, Catalog.LOYALTY.BIRTHDAY_POINTS);
    assert.strictEqual(p.history.filter(h => h.kind === 'BIRTHDAY').length, 1);
  });

  await test('Đợt 2: đánh giá phim – chỉ khách đã soát vé, mỗi đơn 1 lần, CSKH ẩn được', async () => {
    const Store = require('../lib/store');
    const seats = await freeSeats(ST2, 1);
    const o = await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: ST2.id, seats } });
    await payOK(o.data.code);
    const body = { order_code: o.data.code, rating: 5, content: 'Phim rất hay, âm thanh tốt' };
    const early = await call('member', { method: 'POST', token: tokE, query: { action: 'review' }, body });
    assert.strictEqual(early.status, 403); // chưa soát vé
    assert.deepStrictEqual((await call('member', { token: tokE, query: { action: 'can_review', movie: ST2.movie_key } })).data.orders, []);
    const row = await Store.one('orders', { code: o.data.code });
    await Store.insert('ticket_checkins', { order_id: row.id, order_code: row.code, staff_name: 'Quầy', method: 'QR' });
    assert.strictEqual((await call('member', { token: tokE, query: { action: 'can_review', movie: ST2.movie_key } })).data.orders.length, 1);
    assert.strictEqual((await call('member', { method: 'POST', token: tokC, query: { action: 'review' }, body })).status, 404); // đơn của người khác
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'review' }, body: { ...body, rating: 6 } })).status, 400);
    const ok = await call('member', { method: 'POST', token: tokE, query: { action: 'review' }, body });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.ok(!('customer_id' in ok.data.review) && !('order_code' in ok.data.review), 'không lộ khách / mã đơn');
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'review' }, body })).status, 409);
    let list = (await call('member', { query: { action: 'reviews', movie: ST2.movie_key } })).data;
    assert.strictEqual(list.count, 1);
    assert.strictEqual(list.avg, 5);
    assert.strictEqual(list.reviews[0].name, 'eee K.'); // tên rút gọn, không lộ họ tên đầy đủ
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    assert.strictEqual((await quay.post({ action: 'review_hide', id: ok.data.review.id })).status, 403);
    assert.strictEqual((await cs.post({ action: 'review_hide', id: ok.data.review.id, hidden: true })).status, 200);
    list = (await call('member', { query: { action: 'reviews', movie: ST2.movie_key } })).data;
    assert.strictEqual(list.count, 0);
  });

  await test('Đợt 2: mua bắp nước riêng – thanh toán, tích điểm, quầy soát 1 lần và hiện món', async () => {
    const cin = (await call('catalog', { query: { action: 'cinemas' } })).data.cinemas[0];
    assert.strictEqual((await call('create-order', { method: 'POST', token: tokE, body: { kind: 'FNB', cinema_id: cin.id, combos: {} } })).status, 400);
    assert.strictEqual((await call('create-order', { method: 'POST', token: tokE, body: { kind: 'FNB', cinema_id: 'khong-co', combos: { solo: 1 } } })).status, 400);
    const r = await call('create-order', { method: 'POST', token: tokE, body: { kind: 'FNB', cinema_id: cin.id, combos: { solo: 2, sausage: 1 }, total: 2 * 69000 + 25000 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.kind, 'FNB');
    assert.deepStrictEqual(r.data.seats, []);
    await payOK(r.data.code);
    const v = (await call('order-status', { token: tokE, query: { code: r.data.code } })).data;
    assert.strictEqual(v.has_ticket, true);
    assert.strictEqual(v.points_earned, Math.floor(163000 * 0.03 / 1000));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    const ck = await quay.post({ action: 'checkin', qr: v.ticket_qr });
    assert.strictEqual(ck.status, 200, JSON.stringify(ck.data));
    assert.strictEqual(ck.data.summary.kind, 'FNB');
    assert.deepStrictEqual(ck.data.summary.items.map(x => x.qty + 'x' + x.key).sort(), ['1xsausage', '2xsolo']);
    assert.strictEqual((await quay.post({ action: 'checkin', qr: v.ticket_qr })).status, 409);
    // Bắp nước không được để lại đánh giá phim
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'review' }, body: { order_code: r.data.code, rating: 4 } })).status, 400);
  });

  await test('Đợt 2: thư nhắc suất chiếu hôm nay & mời đánh giá – mỗi loại gửi 1 lần', async () => {
    const Store = require('../lib/store');
    const Reminders = require('../lib/reminders');
    // Suất chiếu hôm nay (giờ VN) 1 giờ nữa; nếu đã gần nửa đêm thì bỏ qua phần nhắc
    const soonAt = new Date(Date.now() + 3600e3);
    const sameDay = new Date(soonAt.getTime() + 7 * 3600e3).toISOString().slice(0, 10) === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const today = await Store.insert('orders', { code: 'BC9000000001', user_id: null, email: 'nhac@test.vn', kind: 'TICKET', movie_key: 'suzume', cinema: 'Beta Thanh Xuân', show_date: 'Hôm nay', show_time: '20:00', show_at: soonAt.toISOString(), seats: ['A1'], combos: {}, total: 50000, status: 'CONFIRMED', history: [] });
    const me = (await call('auth', { token: tokE, query: { action: 'me' } })).data.user;
    const past = await Store.insert('orders', { code: 'BC9000000002', user_id: me.id, email: me.email, kind: 'TICKET', movie_key: 'suzume', cinema: 'Beta Thanh Xuân', show_date: 'Hôm qua', show_time: '20:00', show_at: new Date(Date.now() - 20 * 3600e3).toISOString(), seats: ['A2'], combos: {}, total: 50000, status: 'CONFIRMED', history: [] });
    await Store.insert('ticket_checkins', { order_id: past.id, order_code: past.code, staff_name: 'Quầy', method: 'QR' });
    const r1 = await Reminders.run();
    const r2 = await Reminders.run();
    const n = async (code, ev) => (await Store.find('notifications', { order_code: code, event: ev })).length;
    if (sameDay) assert.ok(await n(today.code, 'SHOW_REMINDER') > 0);
    assert.ok(await n(past.code, 'REVIEW_INVITE') > 0);
    assert.strictEqual(r2.show_reminders, 0);
    assert.strictEqual(r2.review_invites, 0);
    assert.ok(r1.review_invites >= 1);
    // Job cron trả kết quả thư nhắc kèm đối soát
    const cron = await call('cron');
    assert.strictEqual(cron.status, 200);
    assert.ok(cron.data.reminders && !cron.data.reminders.error, JSON.stringify(cron.data.reminders));
  });

  // ======================= Đợt 3: phòng chiếu, thuê rạp, báo cáo, nhắc mở bán, SEO =======================
  const CatalogDB3 = require('../lib/catalog-db');
  const tomorrow = CatalogDB3.addDays(CatalogDB3.vnToday(), 1);

  await test('Đợt 3: phòng chiếu có sơ đồ ghế riêng – đặt đúng ghế của phòng, chặn ghế không tồn tại, chặn chồng giờ', async () => {
    const C = require('../catalog');
    assert.throws(() => C.layoutFromText('A standard 0'), /số ghế/);
    assert.throws(() => C.layoutFromText('A standard 10\nA vip 5'), /trùng/);
    assert.throws(() => C.layoutFromText('A ghe 10'), /loại ghế/);
    assert.strictEqual(C.SEAT_IDS.length, 74); // sơ đồ chuẩn không đổi
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const layout_text = 'A standard 12 gap 6 off 1,12\nB vip 10\nK sweetbox 3';
    assert.strictEqual((await cs.post({ action: 'room_save', cinema_id: 'beta-thanh-xuan', name: 'IMAX', layout_text })).status, 403);
    const room = await ql.post({ action: 'room_save', cinema_id: 'beta-thanh-xuan', name: 'Phòng 05 – IMAX', kind: 'IMAX', layout_text });
    assert.strictEqual(room.status, 200, JSON.stringify(room.data));
    const rid = room.data.room.id;
    const mk = await ql.post({ action: 'showtime_create', movie_id: 'suzume', cinema_id: 'beta-thanh-xuan', date: tomorrow, times: '10:00', room_id: rid });
    assert.strictEqual(mk.data.created, 1, JSON.stringify(mk.data));
    // Suất khác chồng giờ trong cùng phòng -> bỏ qua; phòng của rạp khác -> từ chối
    const clash = await ql.post({ action: 'showtime_create', movie_id: 'me-min', cinema_id: 'beta-thanh-xuan', date: tomorrow, times: '10:30', room_id: rid });
    assert.strictEqual(clash.data.created, 0);
    assert.ok(/Phòng 05/.test(clash.data.skipped[0]), JSON.stringify(clash.data));
    assert.strictEqual((await ql.post({ action: 'showtime_create', movie_id: 'me-min', cinema_id: 'beta-my-dinh', date: tomorrow, times: '10:30', room_id: rid })).status, 400);
    const list = (await call('catalog', { query: { action: 'showtimes', movie: 'suzume', date: tomorrow } })).data.showtimes;
    const st = list.find(s => s.room_id === rid);
    assert.strictEqual(st.room, 'Phòng 05 – IMAX');
    assert.strictEqual(st.seats_total, 10 + 10 + 3);
    const one = (await call('catalog', { query: { action: 'showtime', id: st.id } })).data.showtime;
    assert.deepStrictEqual(one.layout.rows.map(r => r.r), ['A', 'B', 'K']);
    // Ghế A1 bị bỏ trống (off), C1 không có trong phòng -> từ chối; K3-K4 (ghế đôi hàng K) hợp lệ
    assert.strictEqual((await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: st.id, seats: ['A1'] } })).status, 400);
    assert.strictEqual((await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: st.id, seats: ['C1'] } })).status, 400);
    const ok = await call('create-order', { method: 'POST', token: tokE, body: { showtime_id: st.id, seats: ['A2', 'B10', 'K3-K4'] } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual(ok.data.total, st.prices.standard + st.prices.vip + st.prices.sweetbox);
    // Sửa sơ đồ làm mất ghế khách đang giữ -> chặn
    const shrink = await ql.post({ action: 'room_save', id: rid, cinema_id: 'beta-thanh-xuan', name: 'Phòng 05 – IMAX', layout_text: 'A standard 12\nB vip 9\nK sweetbox 3' });
    assert.strictEqual(shrink.status, 409);
    assert.ok(/B10/.test(shrink.data.error));
    const rename = await ql.post({ action: 'room_save', id: rid, cinema_id: 'beta-thanh-xuan', name: 'Phòng 05 – IMAX Laser', layout_text: layout_text + '\nL standard 8' });
    assert.strictEqual(rename.status, 200, JSON.stringify(rename.data));
    assert.strictEqual((await call('catalog', { query: { action: 'showtime', id: st.id } })).data.showtime.seats_total, 31);
  });

  await test('Đợt 3: thuê rạp / vé nhóm – khách gửi, tra cứu bằng mã + SĐT, CSKH báo giá → chốt → đã tổ chức', async () => {
    const base = { kind: 'PRIVATE_SHOW', cinema_id: 'beta-thanh-xuan', date: tomorrow, time: '19:00', guests: 40, movie_id: 'suzume', contact_name: 'Công ty ABC', phone: '0912345678', email: 'abc@congty.vn', company: 'ABC' };
    assert.strictEqual((await call('events', { method: 'POST', body: { ...base, kind: 'GROUP', guests: 5 } })).status, 400);
    assert.strictEqual((await call('events', { method: 'POST', body: { ...base, phone: '123' } })).status, 400);
    assert.strictEqual((await call('events', { method: 'POST', body: { ...base, date: '2020-01-01' } })).status, 400);
    const r = await call('events', { method: 'POST', body: base });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const code = r.data.request.code;
    assert.match(code, /^EV-\d{6}$/);
    assert.strictEqual((await call('events', { query: { code, phone: '0999999999' } })).status, 404);
    assert.strictEqual((await call('events', { query: { code, phone: '0912345678' } })).data.request.status, 'NEW');
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    const quay = asStaff(await staffLogin('quay@beta.local'));
    assert.strictEqual((await quay.post({ action: 'event_update', code, status: 'QUOTED', quote_amount: 1 })).status, 403);
    assert.strictEqual((await cs.post({ action: 'event_update', code, status: 'QUOTED' })).status, 400); // thiếu số tiền
    assert.strictEqual((await cs.post({ action: 'event_update', code, status: 'DONE' })).status, 409); // chưa chốt
    assert.strictEqual((await cs.post({ action: 'event_update', code, status: 'QUOTED', quote_amount: 6500000, quote_note: 'Phòng 05, 2 giờ, kèm 40 combo' })).status, 200);
    let v = (await call('events', { query: { code, phone: '0912345678' } })).data.request;
    assert.strictEqual(v.quote_amount, 6500000);
    assert.ok(!('staff_note' in v) && !('phone' in v), 'khách không thấy ghi chú nội bộ');
    assert.strictEqual((await cs.post({ action: 'event_update', code, status: 'CONFIRMED' })).status, 200);
    assert.strictEqual((await cs.post({ action: 'event_update', code, status: 'DONE' })).status, 200);
    const all = (await cs.get('event_list')).data.requests.find(x => x.code === code);
    assert.deepStrictEqual(all.history.map(h => h.status), ['NEW', 'QUOTED', 'CONFIRMED', 'DONE']);
  });

  await test('Đợt 3: báo cáo Quản lý – khung giờ, cơ cấu doanh thu, voucher, Beta Club, xuất CSV', async () => {
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const d = (await ql.get('dashboard')).data;
    assert.strictEqual(d.by_slot.length, 4);
    assert.ok(d.mix.ticket > 0 && d.mix.fnb_only > 0, JSON.stringify(d.mix));
    assert.ok(d.loyalty.earned > 0);
    assert.ok(Array.isArray(d.vouchers) && Array.isArray(d.refunds_by_reason) && Array.isArray(d.occupancy_by_movie));
    assert.ok(d.by_movie.some(x => x.title === 'Bắp nước mua riêng'));
    const Dashboard = require('../lib/dashboard');
    const csv = Dashboard.toCsv(d);
    assert.strictEqual(csv.charCodeAt(0), 0xfeff); // Excel đọc đúng tiếng Việt
    assert.ok(csv.includes('THEO KHUNG GIỜ SUẤT CHIẾU') && csv.includes('BETA CLUB'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    assert.strictEqual((await cs.get('dashboard')).status, 403);
  });

  await test('Đợt 3: "Nhắc tôi khi mở bán" – báo 1 lần khi phim có suất chiếu', async () => {
    const Store = require('../lib/store');
    const Reminders = require('../lib/reminders');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    await ql.post({ action: 'movie_save', id: 'phim-sap-chieu', title: 'Phim Sắp Chiếu', age: 'P', status: 'SOON', duration_min: 95 });
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'watch' }, body: { movie: 'khong-co' } })).status, 404);
    const w = await call('member', { method: 'POST', token: tokE, query: { action: 'watch' }, body: { movie: 'phim-sap-chieu' } });
    assert.strictEqual(w.data.watching, true);
    assert.strictEqual((await Reminders.run()).on_sale, 0); // chưa có suất
    await ql.post({ action: 'showtime_create', movie_id: 'phim-sap-chieu', cinema_id: 'beta-my-dinh', date: tomorrow, times: '20:00' });
    assert.strictEqual((await Reminders.run()).on_sale, 1);
    assert.strictEqual((await Reminders.run()).on_sale, 0);
    assert.strictEqual((await call('member', { token: tokE, query: { action: 'watch', movie: 'phim-sap-chieu' } })).data.watching, false);
    const me = (await call('auth', { token: tokE, query: { action: 'me' } })).data.user;
    assert.strictEqual((await Store.find('notifications', { order_code: 'CUS:' + me.id, event: 'MOVIE_ON_SALE' })).length, 1);
  });

  await test('Đợt 3: SEO – sitemap dùng đường dẫn /phim/, lịch chiếu mở bán tới 30 ngày', async () => {
    const r = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await require('../lib/routes/sitemap')({ query: {}, headers: { host: 'beta.test' } }, r);
    assert.ok(/<loc>http:\/\/beta\.test\/phim\/suzume<\/loc>/.test(r.body) || /\/phim\/suzume</.test(r.body), r.body.slice(0, 300));
    assert.ok(!/movie-detail\?movie=/.test(r.body));
    const far = await call('catalog', { query: { action: 'showtimes', days: 30 } });
    assert.strictEqual(far.status, 200);
  });

  // ======================= Đợt 4: cổng VNPay / MoMo / ZaloPay, hóa đơn điện tử =======================
  const Payments = require('../lib/payments');
  const crypto4 = require('crypto');
  const H = (alg, key, s) => crypto4.createHmac(alg, key).update(Buffer.from(s, 'utf-8')).digest('hex');
  const order4 = async (tok, seats) => {
    const r = await call('create-order', { method: 'POST', token: tok, body: { showtime_id: ST2.id, seats: seats || await freeSeats(ST2, 1) } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };

  await test('Đợt 4: cổng chỉ bật khi có khóa; VNPay – ký đúng, IPN xuất vé, IPN trùng / sai chữ ký bị chặn', async () => {
    assert.deepStrictEqual((await call('pay', { query: { action: 'methods' } })).data.methods.map(m => m.id), ['VIETQR']);
    Object.assign(process.env, { VNPAY_TMN_CODE: 'BETATEST', VNPAY_HASH_SECRET: 'vnp-secret-test', MOMO_PARTNER_CODE: 'MOMOBETA', MOMO_ACCESS_KEY: 'momo-ak', MOMO_SECRET_KEY: 'momo-sk', ZALOPAY_APP_ID: '2553', ZALOPAY_KEY1: 'zp-k1', ZALOPAY_KEY2: 'zp-k2', SITE_URL: 'https://beta.test' });
    assert.deepStrictEqual((await call('pay', { query: { action: 'methods' } })).data.methods.map(m => m.id), ['VIETQR', 'VNPAY', 'MOMO', 'ZALOPAY']);
    const o = await order4(tokE);
    assert.strictEqual((await call('pay', { method: 'POST', token: tokC, query: { action: 'start' }, body: { order_code: o.code, provider: 'vnpay' } })).status, 404); // đơn người khác
    const s = await call('pay', { method: 'POST', token: tokE, query: { action: 'start' }, body: { order_code: o.code, provider: 'vnpay' } });
    assert.strictEqual(s.status, 200, JSON.stringify(s.data));
    const u = new URL(s.data.pay_url);
    assert.strictEqual(u.origin, 'https://sandbox.vnpayment.vn');
    const p = Object.fromEntries(u.searchParams);
    assert.strictEqual(p.vnp_Amount, String(o.total * 100));
    assert.strictEqual(p.vnp_ReturnUrl, 'https://beta.test/api/pay?action=return&provider=vnpay');
    // Chữ ký theo đúng công thức VNPay: sắp xếp khóa, encode, HMAC-SHA512
    const { vnpSignData } = Payments._test;
    assert.strictEqual(p.vnp_SecureHash, H('sha512', 'vnp-secret-test', vnpSignData(p)));
    const ipn = { vnp_TmnCode: 'BETATEST', vnp_Amount: p.vnp_Amount, vnp_TxnRef: p.vnp_TxnRef, vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14000001', vnp_BankCode: 'NCB', vnp_PayDate: p.vnp_CreateDate, vnp_OrderInfo: p.vnp_OrderInfo };
    ipn.vnp_SecureHash = H('sha512', 'vnp-secret-test', vnpSignData(ipn));
    const bad = await call('pay', { query: { action: 'ipn', provider: 'vnpay', ...ipn, vnp_Amount: '100' } });
    assert.strictEqual(bad.data.RspCode, '97'); // sửa số tiền -> sai chữ ký
    const r1 = await call('pay', { query: { action: 'ipn', provider: 'vnpay', ...ipn } });
    assert.strictEqual(r1.data.RspCode, '00', JSON.stringify(r1.data));
    assert.strictEqual((await call('order-status', { token: tokE, query: { code: o.code } })).data.status, 'CONFIRMED');
    assert.strictEqual((await call('pay', { query: { action: 'ipn', provider: 'vnpay', ...ipn } })).data.RspCode, '02');
    // Khách quay về từ VNPay -> chuyển tới trang đơn
    const back = await call('pay', { query: { action: 'return', provider: 'vnpay', ...ipn } });
    assert.strictEqual(back.status, 302);
    assert.strictEqual(back.headers.Location, '/gateway.html?order=' + o.code);
    // Đơn đã xuất vé không bắt đầu thanh toán lại được
    assert.strictEqual((await call('pay', { method: 'POST', token: tokE, query: { action: 'start' }, body: { order_code: o.code, provider: 'vnpay' } })).status, 409);
  });

  await test('Đợt 4: MoMo – tạo phiên, IPN có chữ ký; chuyển thừa -> tự hoàn phần thừa về ví MoMo', async () => {
    const sent = [];
    Payments.net.fetch = async (url, opt) => {
      const b = JSON.parse(opt.body); sent.push({ url, b });
      const json = url.endsWith('/create') ? { resultCode: 0, payUrl: 'https://test-payment.momo.vn/pay/x' } : { resultCode: 0, transId: 9988 };
      return { status: 200, text: async () => JSON.stringify(json) };
    };
    try {
      const o = await order4(tokE);
      const s = await call('pay', { method: 'POST', token: tokE, query: { action: 'start' }, body: { order_code: o.code, provider: 'momo' } });
      assert.strictEqual(s.status, 200, JSON.stringify(s.data));
      const c = sent[0].b;
      const raw = `accessKey=momo-ak&amount=${c.amount}&extraData=&ipnUrl=${c.ipnUrl}&orderId=${c.orderId}&orderInfo=${c.orderInfo}&partnerCode=MOMOBETA&redirectUrl=${c.redirectUrl}&requestId=${c.requestId}&requestType=captureWallet`;
      assert.strictEqual(c.signature, H('sha256', 'momo-sk', raw));
      // Khách trả nhiều hơn (vd ví trừ hai lần) -> vẫn xuất vé và hoàn phần thừa qua API hoàn tiền của MoMo
      const n = { partnerCode: 'MOMOBETA', orderId: c.orderId, requestId: c.requestId, amount: o.total + 10000, orderInfo: c.orderInfo, orderType: 'momo_wallet', transId: 4100001, resultCode: 0, message: 'Thành công.', payType: 'qr', responseTime: Date.now(), extraData: '' };
      n.signature = H('sha256', 'momo-sk', `accessKey=momo-ak&amount=${n.amount}&extraData=&message=${n.message}&orderId=${n.orderId}&orderInfo=${n.orderInfo}&orderType=${n.orderType}&partnerCode=MOMOBETA&payType=qr&requestId=${n.requestId}&responseTime=${n.responseTime}&resultCode=0&transId=4100001`);
      assert.strictEqual((await call('pay', { method: 'POST', query: { action: 'ipn', provider: 'momo' }, body: { ...n, signature: 'sai' } })).status, 400);
      const r = await call('pay', { method: 'POST', query: { action: 'ipn', provider: 'momo' }, body: n });
      assert.strictEqual(r.status, 204);
      const v = (await call('order-status', { token: tokE, query: { code: o.code } })).data;
      assert.strictEqual(v.status, 'CONFIRMED');
      const rf = (await require('../lib/store').find('refunds', { order_code: o.code }))[0];
      assert.strictEqual(rf.reason, 'EXCESS');
      assert.strictEqual(rf.amount, 10000);
      assert.strictEqual(rf.status, 'DONE', JSON.stringify(rf));
      assert.match(rf.refund_ref, /^MOMO-RF:/);
      const rq = sent.find(x => x.url.endsWith('/refund')).b;
      assert.strictEqual(rq.transId, 4100001);
      assert.strictEqual(rq.amount, 10000);
    } finally { Payments.net.fetch = (...a) => fetch(...a); }
  });

  await test('Đợt 4: ZaloPay – callback có MAC đúng mới ghi tiền', async () => {
    Payments.net.fetch = async (url, opt) => ({ status: 200, text: async () => JSON.stringify({ return_code: 1, order_url: 'https://qcgateway.zalopay.vn/openinapp?x=1', _sent: JSON.parse(opt.body) }) });
    try {
      const o = await order4(tokE);
      const s = await call('pay', { method: 'POST', token: tokE, query: { action: 'start' }, body: { order_code: o.code, provider: 'zalopay' } });
      assert.strictEqual(s.status, 200, JSON.stringify(s.data));
      const att = await require('../lib/store').one('payment_attempts', { order_code: o.code, provider: 'ZALOPAY' });
      const data = JSON.stringify({ app_id: 2553, app_trans_id: att.provider_ref, amount: o.total, zp_trans_id: 250000001, server_time: Date.now() });
      assert.strictEqual((await call('pay', { method: 'POST', query: { action: 'ipn', provider: 'zalopay' }, body: { data, mac: 'sai' } })).data.return_code, -1);
      const ok = await call('pay', { method: 'POST', query: { action: 'ipn', provider: 'zalopay' }, body: { data, mac: H('sha256', 'zp-k2', data) } });
      assert.strictEqual(ok.data.return_code, 1);
      assert.strictEqual((await call('order-status', { token: tokE, query: { code: o.code } })).data.status, 'CONFIRMED');
      assert.strictEqual((await require('../lib/store').one('payment_attempts', { order_code: o.code })).status, 'PAID');
    } finally {
      Payments.net.fetch = (...a) => fetch(...a);
      for (const k of ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY', 'ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2', 'SITE_URL']) delete process.env[k];
    }
  });

  await test('Đợt 4: hóa đơn điện tử – khách gửi MST trong hạn, Kế toán xuất CSV và nhập số hóa đơn', async () => {
    const o = await order4(tokE);
    const body = { order_code: o.code, buyer_type: 'COMPANY', tax_code: '0106633482', company_name: 'Công ty TNHH Thử Nghiệm', address: '1 Lê Văn Thiêm, Hà Nội', email: 'ketoan@thunghiem.vn' };
    assert.strictEqual((await call('invoice', { method: 'POST', token: tokE, body })).status, 409); // chưa thanh toán
    await payOK(o.code);
    assert.strictEqual((await call('invoice', { method: 'POST', token: tokE, body: { ...body, tax_code: '12345' } })).status, 400);
    assert.strictEqual((await call('invoice', { method: 'POST', token: tokC, body })).status, 404);
    const r = await call('invoice', { method: 'POST', token: tokE, body });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.request.status, 'PENDING');
    assert.strictEqual(r.data.request.amount, o.total);
    // Sửa thông tin khi còn chờ
    assert.strictEqual((await call('invoice', { method: 'POST', token: tokE, body: { ...body, company_name: 'Công ty TNHH Thử Nghiệm Mới' } })).data.request.company_name, 'Công ty TNHH Thử Nghiệm Mới');
    const kt = asStaff(await staffLogin('ketoan@beta.local'));
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    assert.strictEqual((await cs.get('invoice_list')).status, 403);
    const list = await kt.get('invoice_list');
    assert.ok(list.data.requests.some(x => x.order_code === o.code));
    assert.strictEqual(list.data.provider, 'MANUAL');
    const csv = await call('admin', { query: { action: 'invoice_list', format: 'csv' }, headers: { authorization: 'Bearer ' + kt.token } });
    assert.ok(csv.body && csv.body.charCodeAt(0) === 0xfeff && csv.body.includes('0106633482'), String(csv.body).slice(0, 80));
    assert.strictEqual((await kt.post({ action: 'invoice_issue', order_code: o.code, invoice_no: '0000123', lookup_url: 'http://sai' })).status, 400);
    assert.strictEqual((await kt.post({ action: 'invoice_issue', order_code: o.code, invoice_no: '0000123', invoice_series: '1C26TBC', lookup_url: 'https://tracuu.example.vn/123' })).status, 200);
    const g = (await call('invoice', { token: tokE, query: { code: o.code } })).data;
    assert.strictEqual(g.request.status, 'ISSUED');
    assert.strictEqual(g.request.invoice_no, '0000123');
    assert.strictEqual(g.can_request, false);
    assert.strictEqual((await call('invoice', { method: 'POST', token: tokE, body })).status, 409); // đã xuất thì không sửa
  });

  await test('Đợt 4: song ngữ – từ điển tiếng Anh hợp lệ, mẫu câu dịch đúng', async () => {
    const en = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../i18n/en.json'), 'utf8'));
    assert.ok(Object.keys(en.strings).length > 500);
    for (const [k, v] of Object.entries(en.strings)) assert.ok(typeof v === 'string' && v.trim(), 'thiếu bản dịch: ' + k);
    const pats = en.patterns.map(([re, rep]) => [new RegExp(re), rep]);
    const tr = (s) => { if (en.strings[s]) return en.strings[s]; for (const [re, rep] of pats) { const m = s.match(re); if (m) return rep.replace(/\{(\d)\}/g, (_, k) => en.strings[m[k]] || m[k]).replace(/\$(\d)/g, (_, k) => m[k] || ''); } return null; };
    assert.strictEqual(tr('Ghế C5 thường, Đang có người giữ'), 'Seat C5 standard, held by another customer');
    assert.strictEqual(tr('Bớt vé Trẻ em'), 'Remove Child ticket');
    assert.strictEqual(tr('118 phút'), '118 min');
    assert.strictEqual(tr('/11 - T6'), '/11 - Fri');
    assert.strictEqual(tr('Mã COMBO30 chỉ áp dụng khi mua kèm bắp nước.'), 'Code COMBO30 requires a popcorn & drinks combo.');
    assert.strictEqual(tr('Thanh toán ngay'), 'Pay now');
  });

  // ======================= Đợt 5: vận hành, chặn spam, SEO trang phim, phim yêu thích =======================
  await test('Đợt 5: lỗi 5xx được ghi log, không lộ chi tiết; lỗi dồn dập -> cảnh báo 1 lần / giờ', async () => {
    const Store = require('../lib/store');
    const Ops = require('../lib/ops');
    const { fail } = require('../lib/api-util');
    let out;
    const res = { __route: 'thu-nghiem', status(c) { this.code = c; return this; }, json(d) { out = d; return this; } };
    await fail(res, new Error('connection reset by peer at db:5432'));
    assert.strictEqual(res.code, 500);
    assert.ok(!/5432/.test(out.error), 'không lộ lỗi kỹ thuật cho khách');
    await fail(res, Object.assign(new Error('Ghế đã bán'), { http: 409 }));
    assert.strictEqual(out.error, 'Ghế đã bán');
    for (let i = 0; i < 5; i++) await Ops.error('api:thu-nghiem', new Error('lỗi ' + i));
    const alerts = (await Store.find('notifications', { order_code: 'ALERT', event: 'ALERT:error-burst' }));
    assert.strictEqual(alerts.length, 1, 'chỉ gửi 1 cảnh báo dù nhiều lỗi');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const s = (await ql.get('system_status')).data;
    assert.ok(s.errors_24h >= 6 && s.recent_alerts.length >= 1);
    assert.strictEqual((await asStaff(await staffLogin('ketoan@beta.local')).get('system_status')).status, 403);
  });

  await test('Đợt 5: health, sao lưu chỉ Quản lý, cron ghi lần chạy, chặn spam theo IP', async () => {
    assert.strictEqual((await call('health')).data.db, 'ok');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const bk = await call('admin', { query: { action: 'backup' }, headers: { authorization: 'Bearer ' + ql.token } });
    assert.strictEqual(bk.status, 200);
    const data = JSON.parse(bk.body);
    assert.ok(Array.isArray(data.tables.orders) && data.tables.orders.length > 0 && Array.isArray(data.tables.customers));
    assert.strictEqual((await asStaff(await staffLogin('cskh@beta.local')).get('backup')).status, 403);
    await call('cron');
    assert.ok((await ql.get('system_status')).data.last_cron);
    // Dispatcher: 31 lần POST liên tiếp cùng IP vào cùng API -> lần thứ 31 bị chặn 429
    const dispatch = require('../api/[route].js');
    let last;
    for (let i = 0; i < 31; i++) {
      const res = { headers: {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() {} };
      await dispatch({ method: 'POST', query: { route: 'events' }, body: {}, headers: { 'x-forwarded-for': '203.0.113.9' } }, res);
      last = res;
    }
    assert.strictEqual(last.code, 429);
    assert.ok(Number(last.headers['Retry-After']) > 0);
    // IP khác không bị ảnh hưởng; webhook không bị giới hạn
    const other = { headers: {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; }, setHeader() {}, end() {} };
    await dispatch({ method: 'POST', query: { route: 'events' }, body: {}, headers: { 'x-forwarded-for': '198.51.100.7' } }, other);
    assert.strictEqual(other.code, 400);
  });

  await test('Đợt 5: trang /phim/<mã> có sẵn tiêu đề, mô tả, ảnh chia sẻ, dữ liệu có cấu trúc', async () => {
    const r = await call('movie-page', { query: { slug: 'suzume' }, headers: { host: 'beta.test', 'x-forwarded-proto': 'https' } });
    assert.strictEqual(r.status, 200);
    assert.ok(/<title>KHÓA CHẶT CỬA NÀO SUZUME - Lịch chiếu &amp; đặt vé \| Beta Cinemas<\/title>/.test(r.body));
    assert.ok(r.body.includes('<link rel="canonical" href="https://beta.test/phim/suzume">'));
    assert.ok(r.body.includes('property="og:image" content="https://beta.test/images/'));
    const ld = JSON.parse(r.body.match(/<script type="application\/ld\+json" id="ld-movie">(.*?)<\/script>/)[1]);
    assert.strictEqual(ld['@type'], 'Movie');
    assert.strictEqual(ld.director.name, 'Makoto Shinkai');
    assert.strictEqual((await call('movie-page', { query: { slug: 'khong-co' } })).status, 404);
    assert.strictEqual((await call('movie-page', { query: { slug: '<script>' } })).status, 404);
  });

  await test('Đợt 5: phim yêu thích & phim đã xem', async () => {
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'favorite' }, body: { movie: 'khong-co' } })).status, 404);
    const f = await call('member', { method: 'POST', token: tokE, query: { action: 'favorite' }, body: { movie: 'suzume' } });
    assert.deepStrictEqual(f.data.favorites.map(x => x.key), ['suzume']);
    await call('member', { method: 'POST', token: tokE, query: { action: 'favorite' }, body: { movie: 'suzume' } }); // bấm lại không trùng
    assert.strictEqual((await call('member', { token: tokE, query: { action: 'favorites' } })).data.favorites.length, 1);
    assert.strictEqual((await call('member', { method: 'POST', token: tokE, query: { action: 'favorite' }, body: { movie: 'suzume', on: false } })).data.favorites.length, 0);
    const h = (await call('member', { token: tokE, query: { action: 'history' } })).data.history;
    assert.ok(h.length >= 1, 'đơn đã soát vé ở kiểm thử đánh giá phải hiện là đã xem');
    assert.ok(h.every(x => x.order_code && x.title));
    assert.ok(h.some(x => x.my_rating === 5));
  });

  // ======================= Đợt 6: dữ liệu cá nhân, 2 lớp, lịch chiếu, email ưu đãi, tranh ghế =======================
  await test('Đợt 6: đăng ký phải đồng ý điều khoản; tải dữ liệu; xóa tài khoản ẩn danh đơn hàng; hủy nhận email', async () => {
    const Store = require('../lib/store');
    const Auth = require('../lib/auth');
    const no = await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khong Dong Y', email: 'kdy@x.vn', phone: '0904000001', password: 'matkhau123', accept_terms: false } });
    assert.strictEqual(no.status, 400);
    const r = await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Nguyen Xoa Thu', email: 'xoa@x.vn', phone: '0904000002', password: 'matkhau123', marketing_opt_in: true } });
    assert.strictEqual(r.data.user.marketing_opt_in, true);
    assert.ok(r.data.user.terms_accepted_at && r.data.user.terms_version);
    const tok = r.data.token;
    const seats = await freeSeats(ST2, 2);
    const paid = (await call('create-order', { method: 'POST', token: tok, body: { showtime_id: ST2.id, seats: [seats[0]] } })).data;
    await payOK(paid.code);
    const pending = (await call('create-order', { method: 'POST', token: tok, body: { showtime_id: ST2.id, seats: [seats[1]] } })).data;
    const ex = await call('auth', { token: tok, query: { action: 'export' } });
    const data = JSON.parse(ex.body);
    assert.strictEqual(data.profile.email, 'xoa@x.vn');
    assert.ok(!('password_hash' in data.profile));
    assert.strictEqual(data.orders.length, 2);
    // Còn đơn chờ thanh toán -> chưa cho xóa; sai mật khẩu / thiếu XOA -> chặn
    assert.strictEqual((await call('auth', { method: 'POST', token: tok, query: { action: 'delete' }, body: { password: 'matkhau123', confirm: 'XOA' } })).status, 409);
    await call('order-action', { method: 'POST', token: tok, query: { action: 'cancel', code: pending.code } });
    assert.strictEqual((await call('auth', { method: 'POST', token: tok, query: { action: 'delete' }, body: { password: 'sai', confirm: 'XOA' } })).status, 400);
    assert.strictEqual((await call('auth', { method: 'POST', token: tok, query: { action: 'delete' }, body: { password: 'matkhau123', confirm: 'xoa nhe' } })).status, 400);
    const del = await call('auth', { method: 'POST', token: tok, query: { action: 'delete' }, body: { password: 'matkhau123', confirm: 'XOA' } });
    assert.strictEqual(del.status, 200, JSON.stringify(del.data));
    assert.strictEqual((await call('auth', { token: tok, query: { action: 'me' } })).status, 401); // phiên cũ hết hiệu lực
    assert.strictEqual((await call('auth', { method: 'POST', query: { action: 'login' }, body: { login: 'xoa@x.vn', password: 'matkhau123' } })).status, 401);
    const o = await Store.one('orders', { code: paid.code });
    assert.strictEqual(o.status, 'CONFIRMED'); // đơn vẫn còn (chứng từ kế toán) nhưng không còn thông tin cá nhân
    assert.ok(!o.email && !o.phone && !o.customer_name);
    // Đăng ký lại bằng email cũ được (email đã được giải phóng)
    assert.strictEqual((await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Nguyen Xoa Thu', email: 'xoa@x.vn', phone: '0904000002', password: 'matkhau123' } })).status, 200);
    // Link hủy nhận email: đúng chữ ký mới được
    const c2 = await Store.one('customers', { email: 'xoa@x.vn' });
    await Store.update('customers', { id: c2.id }, { marketing_opt_in: true });
    assert.strictEqual((await call('auth', { query: { action: 'unsubscribe', u: c2.id, t: 'sai' } })).status, 400);
    assert.strictEqual((await call('auth', { query: { action: 'unsubscribe', u: c2.id, t: Auth.unsubToken(c2.id) } })).status, 200);
    assert.strictEqual((await Store.one('customers', { id: c2.id })).marketing_opt_in, false);
  });

  await test('Đợt 6: nhân viên đăng nhập 2 lớp – bật bằng mã đúng, đăng nhập cần mã, chống dùng lại mã, Quản lý đặt lại', async () => {
    const TOTP = require('../lib/totp');
    await require('../lib/throttle').reset('s:ketoan@beta.local');
    const kt = asStaff(await staffLogin('ketoan@beta.local'));
    const s = await kt.post({ action: 'totp_setup' });
    assert.strictEqual(s.status, 200);
    assert.ok(/^otpauth:\/\/totp\//.test(s.data.otpauth));
    assert.strictEqual((await kt.post({ action: 'totp_enable', code: '000000' === TOTP.codeAt(s.data.secret, TOTP.counterNow()) ? '111111' : '000000' })).status, 400);
    const now = Date.now();
    // Bật bằng mã của bước thời gian TRƯỚC (vẫn hợp lệ do cho lệch ±30 giây) để mã hiện tại dùng cho đăng nhập
    const prev = TOTP.codeAt(s.data.secret, TOTP.counterNow(now) - 1);
    assert.strictEqual((await kt.post({ action: 'totp_enable', code: prev })).data.staff.totp_enabled, true);
    const Store = require('../lib/store');
    assert.ok(!/^[A-Z2-7]+$/.test((await Store.one('staff', { email: 'ketoan@beta.local' })).totp_secret), 'khóa bí mật phải được mã hóa');
    const noOtp = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'ketoan@beta.local', password: 'beta-admin' } });
    assert.strictEqual(noOtp.status, 401);
    assert.strictEqual(noOtp.data.need_otp, true);
    const code = TOTP.codeAt(s.data.secret, TOTP.counterNow());
    const ok = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'ketoan@beta.local', password: 'beta-admin', otp: code } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    const replay = await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'ketoan@beta.local', password: 'beta-admin', otp: code } });
    assert.strictEqual(replay.status, 401); // mã đã dùng
    const audits = await Store.find('audit_logs', { action: 'totp_enable' });
    assert.ok(audits.every(a => !String(a.target || '').match(/^\d{6}$/)), 'không ghi mã OTP vào nhật ký');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const staffId = (await Store.one('staff', { email: 'ketoan@beta.local' })).id;
    assert.strictEqual((await kt.post({ action: 'staff_reset_2fa', id: staffId })).status, 403);
    assert.strictEqual((await ql.post({ action: 'staff_reset_2fa', id: staffId })).data.staff.totp_enabled, false);
    await require('../lib/throttle').reset('s:ketoan@beta.local');
    assert.strictEqual((await call('admin', { method: 'POST', query: { action: 'login' }, body: { email: 'ketoan@beta.local', password: 'beta-admin' } })).status, 200);
    // Bắt buộc 2 lớp: chưa bật thì chỉ được thiết lập
    process.env.STAFF_REQUIRE_2FA = '1';
    try {
      const kt2 = asStaff(await staffLogin('ketoan@beta.local'));
      const blocked = await kt2.get('invoice_list');
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual(blocked.data.need_2fa_setup, true);
      assert.strictEqual((await kt2.get('me')).data.staff.require_2fa, true);
      assert.strictEqual((await kt2.post({ action: 'totp_setup' })).status, 200);
    } finally { delete process.env.STAFF_REQUIRE_2FA; }
  });

  await test('Đợt 6: sao chép lịch chiếu sang tuần sau, gợi ý suất theo lấp đầy', async () => {
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const from = CatalogDB3.addDays(CatalogDB3.vnToday(), 1);
    const to = CatalogDB3.addDays(from, 14);
    const before = (await call('catalog', { query: { action: 'showtimes', cinema: 'beta-thanh-xuan', date: to } })).data.showtimes.length;
    const r = await ql.post({ action: 'showtime_copy', cinema_id: 'beta-thanh-xuan', from, to, days: 1 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.created > 0);
    const after = (await call('catalog', { query: { action: 'showtimes', cinema: 'beta-thanh-xuan', date: to } })).data.showtimes;
    assert.strictEqual(after.length, before + r.data.created);
    assert.ok(after.some(s => s.room === 'Phòng 05 – IMAX Laser'), 'giữ đúng phòng có sơ đồ riêng');
    const again = await ql.post({ action: 'showtime_copy', cinema_id: 'beta-thanh-xuan', from, to, days: 1 });
    assert.strictEqual(again.data.created, 0); // chạy lại không nhân đôi
    assert.strictEqual((await ql.post({ action: 'showtime_copy', cinema_id: 'beta-thanh-xuan', from, to: from })).status, 400);
    const ins = await ql.get('schedule_insights');
    assert.strictEqual(ins.status, 200);
    assert.ok(Array.isArray(ins.data.rows) && ins.data.rows.length > 0 && 'advice' in ins.data.rows[0]);
  });

  await test('Đợt 6: email ưu đãi chỉ tới khách đồng ý nhận, gửi theo đợt, bỏ qua người vừa hủy', async () => {
    const Store = require('../lib/store');
    const ql = asStaff(await staffLogin('quanly@beta.local'));
    const mk = async (n, opt) => (await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Khach Mkt ' + n, email: 'mkt' + n + '@x.vn', phone: '090500000' + n, password: 'matkhau123', marketing_opt_in: opt } })).data.user;
    const users = [];
    for (let i = 1; i <= 9; i++) users.push(await mk(i, i <= 6)); // 6 người đồng ý, 3 người không
    const pv = await ql.post({ action: 'campaign_preview', segment: 'ALL' });
    const optIn = (await Store.find('customers', { marketing_opt_in: true })).filter(c => !c.deleted_at).length;
    assert.strictEqual(pv.data.count, optIn);
    assert.strictEqual((await ql.post({ action: 'campaign_create', subject: 'Ngắn', message: 'x', segment: 'ALL' })).status, 400);
    const cr = await ql.post({ action: 'campaign_create', subject: 'Thứ Ba vui vẻ giảm 15%', message: 'Chào {ten}, suất chiếu thứ Ba giảm 15% với mã T3VUIVE.', segment: 'ALL' });
    assert.strictEqual(cr.status, 200, JSON.stringify(cr.data));
    assert.strictEqual(cr.data.total, optIn);
    assert.strictEqual((await ql.post({ action: 'campaign_create', subject: 'Thứ Ba vui vẻ giảm 15%', message: 'Chào {ten}, suất chiếu thứ Ba giảm 15% với mã T3VUIVE.', segment: 'ALL' })).status, 409);
    // Một người hủy đăng ký giữa chừng
    await Store.update('customers', { id: users[0].id }, { marketing_opt_in: false });
    let c;
    for (let i = 0; i < 50; i++) { c = (await ql.post({ action: 'campaign_step', id: cr.data.id })).data.campaign; if (c.status === 'DONE') break; }
    assert.strictEqual(c.status, 'DONE');
    assert.strictEqual(c.cursor, optIn);
    assert.strictEqual(c.sent + c.failed + c.skipped, optIn); // chưa cấu hình email -> bỏ qua, không lỗi
    const cs = asStaff(await staffLogin('cskh@beta.local'));
    assert.strictEqual((await cs.post({ action: 'campaign_create', subject: 'abcdef', message: 'x'.repeat(30), segment: 'ALL' })).status, 403);
  });

  await test('Đợt 6: 20 khách cùng giành 1 ghế cùng lúc -> đúng 1 người giữ được', async () => {
    const seat = (await freeSeats(ST2, 1))[0];
    const toks = [];
    for (let i = 0; i < 20; i++) toks.push((await call('auth', { method: 'POST', query: { action: 'register' }, body: { full_name: 'Tranh Ghe ' + i, email: 'tranh' + i + '@x.vn', phone: '09060000' + String(i).padStart(2, '0'), password: 'matkhau123' } })).data.token);
    const rs = await Promise.all(toks.map(t => call('create-order', { method: 'POST', token: t, body: { showtime_id: ST2.id, seats: [seat] } })));
    assert.strictEqual(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join(','));
    assert.ok(rs.filter(r => r.status !== 200).every(r => r.status === 409));
    const holds = await require('../lib/store').find('seat_holds', { showtime_key: ST2.id, seat_id: seat });
    assert.strictEqual(holds.length, 1);
  });

  for (const [ok, name] of results) console.log(ok, name);
  const failed = results.filter(r => r[0] === '✗').length;
  console.log(failed ? `\n${failed} kiểm thử LỖI` : `\nTất cả ${results.length} kiểm thử đều đạt`);
  process.exit(failed ? 1 : 0);
})();
