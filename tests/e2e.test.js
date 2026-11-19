// tests/e2e.test.js - Kiểm thử end-to-end giao diện Beta Cinemas
// Chạy: npm test
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, launch, newPage, text, ROOT } = require('./helpers');

let server, browser, B;

before(async () => {
  server = await startServer();
  B = server.url;
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.stop();
});

const PAGES = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html'));
// Ngày mai (không bị ảnh hưởng bởi suất "đã chiếu" trong hôm nay)
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const tm = new Date(Date.now() + 864e5);
const TOMORROW = `${DOW[tm.getDay()]} ${String(tm.getDate()).padStart(2, '0')}/${String(tm.getMonth() + 1).padStart(2, '0')}`;
const showQuery = time => `movie=an-mang-karaoke&cinema=Beta%20Thanh%20Xu%C3%A2n&date=${encodeURIComponent(TOMORROW)}&time=${time}`;

// Ghế còn trống đầu tiên của một loại ghế trên trang chọn ghế
const freeSeat = (page, type) => page.evaluate(t =>
  [...document.querySelectorAll(`.r i[data-type="${t}"]`)].map(e => e.dataset.id)[0], type);

describe('Tất cả các trang', () => {
  test('mở được và không có lỗi JavaScript', async () => {
    const page = await newPage(browser);
    const problems = [];
    for (const f of PAGES) {
      page.jsErrors.length = 0;
      const res = await page.goto(B + f);
      await page.waitForTimeout(300);
      if (!res || res.status() !== 200) problems.push(`${f}: HTTP ${res && res.status()}`);
      page.jsErrors.forEach(e => problems.push(`${f}: ${e}`));
    }
    await page.context().close();
    assert.deepEqual(problems, []);
  });

  test('không tràn ngang trên điện thoại (390px)', async () => {
    const page = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const wide = [];
    for (const f of PAGES) {
      await page.goto(B + f);
      await page.waitForTimeout(200);
      const w = await page.evaluate(() => {
        document.documentElement.style.overflowX = 'visible';
        document.body.style.overflowX = 'visible';
        return document.documentElement.scrollWidth;
      });
      if (w > 392) wide.push(`${f}: ${w}px`);
    }
    await page.context().close();
    assert.deepEqual(wide, []);
  });
});

describe('Luồng đặt vé', () => {
  test('chọn ghế → combo → thanh toán → vé → lịch sử tài khoản', async () => {
    const page = await newPage(browser);
    // Lấy một suất còn bán được của ngày mai từ trang đặt vé
    await page.goto(B + 'booking.html?movie=an-mang-karaoke&date=' + encodeURIComponent(TOMORROW));
    const time = await page.getAttribute('.sl.on', 'data-time');
    const SHOW = showQuery(time);

    await page.goto(B + 'seats.html?' + SHOW);
    assert.equal(await text(page, '#checkout-selected-seats'), 'Chưa chọn ghế');

    const vip = await freeSeat(page, 'vip');
    const std = await freeSeat(page, 'standard');
    for (const id of [vip, std]) {
      await page.evaluate(i => document.querySelector(`.r i[data-id="${i}"]`).click(), id);
    }
    assert.match(await text(page, '#checkout-meta-detail'), /1 Ghế VIP \+ 1 Ghế Thường/);

    await page.click('#btn-next-step, #btn-next-checkout');
    await page.waitForURL(/combo\.html/);
    await page.evaluate(() => updateQty('couple', 1));
    await page.click('#btn-next-checkout');
    await page.waitForURL(/checkout\.html/);

    // Quay lại vẫn giữ combo và ghế
    await page.click('#btn-back-seats');
    await page.waitForURL(/combo\.html/);
    assert.equal(await text(page, '#qty-couple'), '1');
    await page.click('#btn-back-seats');
    await page.waitForURL(/seats\.html/);
    assert.equal(await text(page, '#checkout-selected-seats'), `${vip}, ${std}`);

    await page.click('#btn-next-step, #btn-next-checkout');
    await page.click('#btn-next-checkout');
    await page.waitForURL(/checkout\.html/);
    await page.click('#btn-submit-pay');
    await page.waitForURL(/gateway\.html/);
    const code = new URL(page.url()).searchParams.get('order');
    assert.match(code, /^BC\d{10}$/);

    await page.evaluate(() => triggerSimulation('OK')).catch(() => {});
    await page.waitForURL(/ticket\.html/, { timeout: 15000 });

    // Ghế vừa mua bị khóa ở đúng suất đó
    await page.goto(B + 'seats.html?' + SHOW);
    assert.equal(await page.getAttribute(`.r i[data-id="${vip}"]`, 'class'), 'x');
    assert.equal(await page.getAttribute(`.r i[data-id="${std}"]`, 'class'), 'x');

    await page.goto(B + 'account.html');
    const card = page.locator(`.order-history-item[data-code="${code}"]`);
    await card.waitFor({ timeout: 10000 });
    assert.match(await card.innerText(), /Combo Couple × 1/);
    assert.deepEqual(page.jsErrors, []);
    await page.context().close();
  });
});

describe('Suất chiếu', () => {
  test('cùng phim / rạp / ngày cho cùng suất ở mọi trang, đổi ngày thì đổi suất', async () => {
    const page = await newPage(browser);
    const q = 'movie=suzume&cinema=Beta%20M%E1%BB%B9%20%C4%90%C3%ACnh&date=' + encodeURIComponent(TOMORROW);
    await page.goto(B + 'booking.html?' + q);
    const booking = await page.$$eval('.sl', els => els.map(e => e.dataset.time + '/' + e.dataset.available));
    assert.ok(booking.length >= 5, 'mỗi ngày có ít nhất 5 suất');
    await page.reload();
    assert.deepEqual(await page.$$eval('.sl', els => els.map(e => e.dataset.time + '/' + e.dataset.available)), booking);

    // Trang lịch chiếu của rạp đó có đủ phim đang chiếu và cùng các giờ chiếu
    await page.goto(B + 'schedule.html?cinema=Beta%20M%E1%BB%B9%20%C4%90%C3%ACnh');
    await page.locator('.date-item-official').nth(1).click();
    assert.ok(await page.locator('.sch-movie-row').count() >= 8);
    const row = page.locator('.sch-movie-row', { hasText: 'Suzume' });
    const times = await row.locator('.sch-slot-time').allTextContents();
    assert.deepEqual(times, booking.map(x => x.split('/')[0]));

    // Số ghế trống ở trang đặt vé khớp với sơ đồ ghế
    const [t, avail] = booking[0].split('/');
    await page.goto(B + 'seats.html?' + q + '&time=' + t);
    const free = await page.$$eval('.r i', els => els.filter(e => !/^(x|h|k)$/.test(e.className)).length);
    assert.equal(free, Number(avail));
    await page.context().close();
  });

  test('phim sắp chiếu không bán vé trước ngày khởi chiếu', async () => {
    const page = await newPage(browser);
    await page.goto(B + 'booking.html?movie=me-min');
    assert.equal(await page.locator('.sl').count(), 0);
    assert.match(await text(page, '#showtime-groups'), /khởi chiếu từ/);
    await page.context().close();
  });
});

describe('Tài khoản', () => {
  test('trang cần đăng nhập chuyển sang đăng nhập rồi quay lại', async () => {
    const page = await newPage(browser);
    await page.goto(B + 'home.html');
    await page.evaluate(() => Layout.setUser(null));
    await page.goto(B + 'account.html');
    await page.waitForURL(/auth\.html\?next=account\.html/);

    await page.fill('#login-id', 'luonghonganh@betacinemas.vn');
    await page.fill('#input-login-password', 'sai-mat-khau');
    await page.click('#view-login .btn-b');
    assert.match(await text(page, '#login-error'), /không đúng/);

    await page.fill('#input-login-password', '12345678');
    await page.click('#view-login .btn-b');
    await page.waitForURL(/account\.html/);
    assert.equal(await text(page, '#member-card-name'), 'LƯƠNG HỒNG ANH');
    await page.context().close();
  });

  test('đăng ký kiểm tra dữ liệu và chỉ thấy đơn của mình', async () => {
    const page = await newPage(browser);
    await page.goto(B + 'auth.html#register');
    const submit = () => page.click('#view-register .btn-b');

    await page.fill('#reg-name', 'Trần Thị Test');
    await page.fill('#reg-phone', '123');
    await submit();
    assert.match(await text(page, '#register-error'), /10 chữ số/);

    await page.fill('#reg-phone', '0911222333');
    await page.fill('#reg-email', 'test@example.com');
    await page.fill('#reg-dob', '2001-02-03');
    await page.fill('#reg-password', 'abcd1234');
    await page.fill('#reg-password2', 'khac1234');
    await submit();
    assert.match(await text(page, '#register-error'), /không khớp/);

    await page.fill('#reg-password2', 'abcd1234');
    await page.check('#reg-agree');
    await submit();
    await page.waitForURL(/account\.html/);
    assert.equal(await text(page, '#member-card-name'), 'TRẦN THỊ TEST');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.order-history-item').count(), 0);
    await page.context().close();
  });
});

describe('Trang chi tiết', () => {
  test('chi tiết phim theo ?movie=', async () => {
    const page = await newPage(browser);
    await page.goto(B + 'movie-detail.html?movie=suzume');
    assert.equal(await text(page, '#md-title'), 'KHÓA CHẶT CỬA NÀO SUZUME');
    assert.match(await page.getAttribute("a[href*='seats.html']", 'href'), /movie=suzume/);
    await page.context().close();
  });

  test('trang đơn hủy / đã hoàn / hóa đơn đọc đúng đơn', async () => {
    const page = await newPage(browser);
    await page.goto(B + 'invoice.html');
    await page.evaluate(() => Pay.saveLocalOrder({
      code: 'BC9990001111', status: 'PAID', movie_key: 'me-min', cinema: 'Beta Giải Phóng',
      show_date: 'T6 20/11', show_time: '21:15', seats: ['E3', 'E4'], combos: { couple: 1 },
      total: 189000, phone: '0977000111', customer_name: 'PHẠM VĂN CƯỜNG'
    }));

    await page.goto(B + 'ticket-cancelled.html?order=BC9990001111');
    assert.equal(await text(page, '#cancel-movie-title'), 'Mẹ Mìn');
    assert.equal(await text(page, '#cancel-seats'), 'E3, E4');

    await page.goto(B + 'ticket-refunded.html?order=BC9990001111');
    assert.equal(await text(page, '#combos-display'), 'Combo Couple × 1');

    await page.goto(B + 'invoice.html?order=BC9990001111');
    assert.equal(await text(page, '#page-inv-customer-name'), 'PHẠM VĂN CƯỜNG');
    assert.equal(await text(page, '#page-inv-total'), '189.000 đ');

    await page.goto(B + 'ticket-refunded.html?order=BC2610208819');
    assert.equal(await text(page, '#refund-code-display'), 'REF-2610-889');
    assert.deepEqual(page.jsErrors, []);
    await page.context().close();
  });
});

describe('API', () => {
  test('tạo đơn và đọc lại trạng thái', async () => {
    const res = await fetch(B + 'api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movie_key: 'suzume', seats: ['A1'], total: 45000, phone: '0900000000' })
    });
    const o = await res.json();
    assert.equal(res.status, 200);
    assert.match(o.code, /^BC\d{10}$/);

    const st = await (await fetch(B + 'api/order-status?code=' + o.code)).json();
    assert.equal(st.code, o.code);
    assert.equal(st.status, 'HOLDING');
  });

  test('chặn truy cập file ngoài public/', async () => {
    const res = await fetch(B + '%2e%2e/server.js');
    assert.equal(res.status, 404);
  });
});
