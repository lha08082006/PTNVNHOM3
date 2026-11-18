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
    const view = await call('order-status', { query: { code: SOON_CODE } });
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

  for (const [ok, name] of results) console.log(ok, name);
  const failed = results.filter(r => r[0] === '✗').length;
  console.log(failed ? `\n${failed} kiểm thử LỖI` : `\nTất cả ${results.length} kiểm thử đều đạt`);
  process.exit(failed ? 1 : 0);
})();
