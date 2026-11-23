// tools/e2e-test.js - Kiểm thử trọn luồng trên trình duyệt thật (Đợt 6)
// Đăng ký -> trang phim -> chọn suất -> "chọn giúp ghế đẹp" -> thêm combo -> thanh toán VietQR (sandbox)
// -> vé có mã QR -> nhân viên quầy đăng nhập admin và soát vé -> hợp lệ; soát lần 2 -> bị chặn.
// Chạy: npm run test:e2e   (cần Chrome/Edge; đặt CHROME_PATH nếu không tự tìm thấy – không có thì bỏ qua)
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|qr\.sepay\.vn|img\.vietqr|youtube\.com|ytimg\.com/;
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); s.on('error', no); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// E2E_SHOTS=<thư mục>: chụp trang vé và trang đặt vé (máy tính + điện thoại) để xem giao diện
const SHOTS = process.env.E2E_SHOTS || '';

async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_MODE: 'mock' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('Server không khởi động được')), 15000);
    proc.stdout.on('data', d => { if (String(d).includes('ĐANG CHẠY')) { clearTimeout(timer); ok(); } });
    proc.on('exit', c => no(new Error('Server thoát sớm, mã ' + c)));
  });
  return { url: `http://localhost:${port}`, stop: () => proc.kill() };
}

const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); steps.push(['✓', name, Date.now() - t0]); }
  catch (e) { steps.push(['✗', name + ' → ' + e.message]); throw e; }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  if (!exe) { console.log('Bỏ qua kiểm thử e2e: không tìm thấy Chrome/Edge (đặt CHROME_PATH).'); return; }
  const puppeteer = require('puppeteer-core');
  const srv = await startServer();
  const B = srv.url;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  let ok = false;
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.setRequestInterception(true);
    p.on('request', r => EXTERNAL.test(r.url()) ? r.abort() : r.continue());
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => d.accept());
    const api = (pathname, opts) => p.evaluate(async (u, o) => { const r = await fetch(u, o); return { status: r.status, data: await r.json().catch(() => null) }; }, pathname, opts || {});
    const st = { id: null, code: null, qr: null };

    await step('Quản lý tạo suất chiếu 90 phút nữa (để soát vé được)', async () => {
      await p.goto(B + '/home.html', { waitUntil: 'networkidle2' });
      const lg = await api('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: 'quanly@beta.local', password: 'beta-admin' }) });
      expect(lg.status === 200, 'Quản lý không đăng nhập được');
      const soon = new Date(Date.now() + 7 * 3600e3 + 90 * 60000);
      const date = soon.toISOString().slice(0, 10), time = soon.toISOString().slice(11, 16);
      const r = await api('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lg.data.token }, body: JSON.stringify({ action: 'showtime_create', movie_id: 'suzume', cinema_id: 'beta-thanh-xuan', date, times: time }) });
      expect(r.status === 200 && r.data.created === 1, 'Không tạo được suất: ' + JSON.stringify(r.data));
      const list = await api('/api/catalog?action=showtimes&movie=suzume&cinema=beta-thanh-xuan&date=' + date);
      st.id = list.data.showtimes.find(s => s.time === time).id;
      st.date = date;
    });

    await step('Khách đăng ký tài khoản trên trang (đồng ý điều khoản)', async () => {
      await p.goto(B + '/auth.html#register', { waitUntil: 'networkidle2' });
      await p.evaluate(() => typeof switchToView === 'function' && switchToView('register'));
      await p.type('#reg-name', 'Khach E2E');
      await p.type('#reg-phone', '0907' + String(Date.now()).slice(-6));
      await p.type('#reg-email', 'e2e' + Date.now() + '@x.vn');
      await p.type('#reg-password', 'matkhau123');
      await p.type('#reg-password2', 'matkhau123');
      await p.click('#reg-terms');
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('#btn-register')]);
      expect(/account\.html/.test(p.url()), 'Không vào được trang tài khoản sau khi đăng ký: ' + p.url());
    });

    await step('Trang phim /phim/suzume: chọn rạp, ngày, bấm suất', async () => {
      await p.goto(B + '/phim/suzume', { waitUntil: 'networkidle2' });
      expect(/SUZUME/i.test(await p.title()), 'Tiêu đề trang phim sai');
      await p.select('#md-cinema', 'beta-thanh-xuan');
      await p.select('#md-date', st.date);
      await sleep(300);
      const link = await p.$(`#md-slots a[href*="${st.id}"]`);
      expect(link, 'Không thấy suất vừa tạo trên trang phim');
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), link.click()]);
      expect(p.url().includes('seats.html?showtime=' + st.id), 'Không sang trang chọn ghế');
    });

    await step('Chọn giúp 2 ghế VIP đẹp nhất', async () => {
      await sleep(800);
      await p.select('#ap-type', 'vip');
      await p.select('#ap-count', '2');
      await p.click('#ap-go');
      const seats = await p.$eval('#checkout-selected-seats', el => el.textContent.trim());
      expect(/^[FG]\d+, [FG]\d+$/.test(seats), 'Ghế được chọn: ' + seats);
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('#btn-next-checkout')]);
      expect(/combo\.html/.test(p.url()), 'Không sang bước combo');
    });

    await step('Thêm 1 Combo Solo, sang thanh toán', async () => {
      await sleep(600);
      const add = await p.$('button[aria-label="Thêm Combo Solo"]');
      expect(add, 'Không thấy nút thêm combo');
      await add.click();
      await sleep(200);
      // Nút công cụ dev (quick-dock, chỉ hiện ở localhost) có thể đè lên nút – bấm bằng DOM
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.$eval('#btn-next-checkout', el => el.click())]);
      expect(/checkout\.html/.test(p.url()), 'Không sang trang thanh toán');
    });

    await step('Đồng ý điều khoản, bấm Thanh toán -> trang VietQR', async () => {
      await sleep(800);
      const total = await p.$eval('#summary-total-amount', el => el.textContent);
      expect(/\d/.test(total), 'Chưa có tổng tiền');
      await p.click('#terms-checkbox');
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('#btn-submit-pay')]);
      expect(/gateway\.html\?order=BC\d{10}/.test(p.url()), 'Không sang trang VietQR: ' + p.url());
      st.code = new URL(p.url()).searchParams.get('order');
    });

    await step('Ngân hàng báo đã nhận tiền (sandbox) -> tự sang trang vé có mã vạch', async () => {
      const r = await api('/api/simulate-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'OK', order_code: st.code }) });
      expect(r.status === 200, 'Sandbox lỗi: ' + JSON.stringify(r.data));
      await p.waitForFunction(() => /ticket\.html/.test(location.href), { timeout: 15000 });
      await p.waitForSelector('#ticket-barcode svg', { timeout: 10000 });
      if (SHOTS) { await sleep(500); await p.screenshot({ path: path.join(SHOTS, 'e2e-ticket.png'), fullPage: true }); }
      const tok = await p.evaluate(() => localStorage.getItem('BETA_AUTH_TOKEN'));
      const v = await api('/api/order-status?code=' + st.code, { headers: { Authorization: 'Bearer ' + tok } });
      expect(v.data.status === 'CONFIRMED' && v.data.combos.solo === 1 && v.data.seats.length === 2, 'Đơn sai: ' + JSON.stringify({ s: v.data.status, c: v.data.combos }));
      st.qr = v.data.ticket_barcode;
      expect(/^BC\d{18}$/.test(st.qr || ''), 'Mã vạch sai dạng: ' + st.qr);
    });

    await step('Nhân viên quầy đăng nhập admin, soát vé: hợp lệ; soát lần 2: bị chặn', async () => {
      const a = await browser.newPage();
      await a.setViewport({ width: 1280, height: 900 });
      a.on('pageerror', e => errors.push('admin: ' + e.message));
      if (process.env.DEBUG_E2E) a.on('response', async r => { if (r.url().includes('/api/admin')) console.log('  [admin]', r.status(), (r.request().postData() || r.url()).slice(0, 70), (await r.text().catch(() => '')).slice(0, 120)); });
      await a.goto(B + '/admin.html', { waitUntil: 'networkidle2' });
      await a.type('#lg-email', 'quay@beta.local');
      await a.type('#lg-pass', 'beta-admin');
      await a.$eval('#login-form button', el => el.click());
      // Chờ đăng nhập xong hẳn (thanh tài khoản hiện, danh sách tab đã lọc theo vai trò)
      await a.waitForFunction(() => !document.getElementById('who').hidden && document.getElementById('tabs').style.display === 'flex', { timeout: 10000 });
      await a.$eval('#tabs button[data-tab="quay"]', el => el.click());
      await a.waitForSelector('#ck-input', { visible: true, timeout: 5000 });
      // Quầy đang chọn rạp khác: báo "VÉ CỦA RẠP KHÁC", vé chưa bị đánh dấu đã soát
      await a.waitForFunction(() => document.querySelectorAll('#qc-cinema option').length > 1, { timeout: 5000 });
      const other = await a.$eval('#qc-cinema', s => [...s.options].map(o => o.value).find(v => v !== 'beta-thanh-xuan'));
      await a.select('#qc-cinema', other);
      await a.type('#ck-input', st.qr);
      await a.keyboard.press('Enter');
      await a.waitForFunction(() => /RẠP KHÁC/.test(document.getElementById('ck-result').innerText), { timeout: 10000 });
      if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'e2e-quay-rap-khac.png') });
      // Chọn đúng rạp rồi quét lại: hợp lệ
      await a.select('#qc-cinema', 'beta-thanh-xuan');
      await a.type('#ck-input', st.qr);
      await a.keyboard.press('Enter');
      await a.waitForFunction(() => /HỢP LỆ – MỜI VÀO|KHÔNG HỢP LỆ/.test(document.getElementById('ck-result').innerText), { timeout: 10000 });
      if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'e2e-quay-hop-le.png') });
      const first = await a.$eval('#ck-result', el => el.innerText);
      expect(/HỢP LỆ – MỜI VÀO/.test(first), 'Lần 1: ' + first.slice(0, 120));
      expect(/1 × Combo Solo|Ghế/.test(first), 'Thiếu thông tin ghế');
      await a.type('#ck-input', st.qr);
      await a.keyboard.press('Enter');
      await a.waitForFunction(() => /ĐÃ ĐƯỢC SOÁT/.test(document.getElementById('ck-result').innerText), { timeout: 10000 });
    });

    // ===== Đợt 8 + 9: điện thoại – menu ☰, tìm rạp không dấu, trang Rạp; Mua vé nhanh 4 bước =====
    await step('Điện thoại: mở menu ☰, tìm "my dinh" ra Beta Mỹ Đình, mở trang rạp có suất chiếu', async () => {
      const m = await browser.newPage();
      await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await m.setRequestInterception(true);
      m.on('request', r => EXTERNAL.test(r.url()) ? r.abort() : r.continue());
      m.on('pageerror', e => errors.push(e.message));
      await m.goto(B + '/home.html', { waitUntil: 'networkidle2' });
      await m.waitForSelector('.hdr-burger', { visible: true });
      await m.$eval('.hdr-burger', el => el.click());
      await m.waitForFunction(() => document.body.classList.contains('drawer-open'));
      const items = await m.$$eval('#site-drawer .sd-nav a', as => as.map(a => a.getAttribute('href')));
      expect(items.includes('rap.html') && items.includes('schedule.html'), 'Menu thiếu mục: ' + items.join(','));
      await m.keyboard.press('Escape');
      await m.waitForFunction(() => !document.body.classList.contains('drawer-open'));
      await m.$eval('.hdr-search', el => el.click());
      await m.waitForSelector('#ss-q', { visible: true });
      await m.type('#ss-q', 'my dinh');
      await m.waitForFunction(() => /Mỹ Đình/.test(document.getElementById('ss-list').innerText), { timeout: 8000 });
      await m.keyboard.press('Enter');
      await m.waitForFunction(() => /rap\.html\?id=beta-my-dinh/.test(location.href), { timeout: 8000 });
      await m.waitForFunction(() => document.querySelectorAll('#rd-shows .rd-times a').length > 0, { timeout: 10000 });
      const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(over <= 2, 'Trang rạp tràn ngang ' + over + 'px');
      await m.close();
    });

    await step('Trang chủ: Mua vé nhanh Phim → Rạp → Ngày → Suất vào thẳng trang chọn ghế', async () => {
      await p.bringToFront(); // tab nền không chạy requestAnimationFrame -> waitForFunction treo
      await p.goto(B + '/home.html', { waitUntil: 'networkidle2' });
      await p.waitForFunction(() => document.querySelectorAll('#qb-movie option[value]:not([value=""])').length > 0, { timeout: 8000 });
      await p.select('#qb-movie', 'suzume');
      const qbState = () => p.evaluate(() => ['qb-movie', 'qb-cinema', 'qb-date', 'qb-time'].map(id => { const e = document.getElementById(id); return id + '=' + e.value + (e.disabled ? '(khóa)' : '') + '[' + e.options.length + ': ' + (e.options[0] || {}).textContent + ']'; }).join(' '));
      await p.waitForFunction(() => !document.getElementById('qb-cinema').disabled && document.querySelectorAll('#qb-cinema option').length > 1, { timeout: 8000 }).catch(async (e) => { throw new Error(e.message + ' – ' + await qbState()); });
      const cin = await p.$$eval('#qb-cinema option', os => os.map(o => o.value).find(Boolean));
      await p.select('#qb-cinema', cin);
      const t = await p.$$eval('#qb-time option', os => (os.find(o => o.value && !o.disabled) || {}).value);
      expect(t, 'Không có suất còn ghế');
      await p.select('#qb-time', t);
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.$eval('#qb-go', el => el.click())]);
      expect(p.url().includes('seats.html?showtime=' + t), 'Sai trang: ' + p.url());
      await p.waitForSelector('.r i[data-id]', { timeout: 8000 });
    });

    // ===== Đợt 10: Quản lý sửa phim + thêm banner trong admin -> trang chủ hiện đúng =====
    await step('Quản lý đổi tên phim, thêm banner -> trang chủ hiện tên mới và banner mới', async () => {
      await p.bringToFront();
      await p.goto(B + '/home.html', { waitUntil: 'networkidle2' });
      const r = await p.evaluate(async () => {
        const j = (u, o) => fetch(u, o).then(x => x.json());
        const lg = await j('/api/admin?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'quanly@beta.local', password: 'beta-admin' }) });
        const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lg.token };
        const cat = await j('/api/admin?action=catalog', { headers: H });
        const m = cat.movies.find(x => x.id === 'suzume');
        const a = await j('/api/admin', { method: 'POST', headers: H, body: JSON.stringify({ action: 'movie_save', ...m, id: 'suzume', title: 'SUZUME BẢN CHIẾU LẠI', cast: m.cast_list, status: 'SOON', release_date: '2026-12-25' }) });
        const b = await j('/api/admin', { method: 'POST', headers: H, body: JSON.stringify({ action: 'banner_save', title: 'Banner kiểm thử Đợt 10', image: 'images/t3.webp', link: 'phim/suzume' }) });
        return { a: a.ok, b: b.ok, err: a.error || b.error };
      });
      expect(r.a && r.b, 'Lưu không được: ' + r.err);
      await p.goto(B + '/home.html', { waitUntil: 'networkidle2' });
      await p.waitForFunction(() => [...document.querySelectorAll('#movie-grid .movie-title-official')].some(t => t.textContent.includes('SUZUME BẢN CHIẾU LẠI')), { timeout: 8000 }).catch(async (e) => { throw new Error('thẻ phim: ' + e.message + ' – ' + await p.evaluate(() => [...document.querySelectorAll('#movie-grid .movie-title-official')].map(t => t.textContent.trim()).join(' | '))); });
      const card = await p.evaluate(() => { const c = document.querySelector('#movie-grid .movie-card[data-key="suzume"]'); return { tab: c.dataset.tab, buy: c.querySelector('.ma-buy').textContent.trim(), meta: c.querySelector('.movie-meta-official').textContent }; });
      expect(/soon/.test(card.tab) && /Đặt trước/.test(card.buy) && /25\/12\/2026/.test(card.meta), 'Thẻ phim chưa theo admin: ' + JSON.stringify(card));
      await p.waitForFunction(() => [...document.querySelectorAll('.slider-item img')].some(i => i.alt === 'Banner kiểm thử Đợt 10'), { timeout: 8000 }).catch(async (e) => { throw new Error('banner: ' + e.message + ' – ' + await p.evaluate(async () => [...document.querySelectorAll('.slider-item img')].map(i => i.alt).join(' | ') + ' / API: ' + JSON.stringify(await (await fetch('/api/catalog?action=banners')).json()))); });
      const href = await p.$eval('.slider-item a', a => a.getAttribute('href'));
      expect(href === 'phim/suzume', 'Banner chưa có link: ' + href);
    });

    expect(!errors.length, 'Lỗi JavaScript: ' + errors.join(' | '));
    if (SHOTS) {
      for (const [w, h, name] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
        await p.setViewport({ width: w, height: h });
        await p.goto(B + '/booking.html?movie=suzume&cinema=beta-thanh-xuan', { waitUntil: 'networkidle2' });
        await p.waitForSelector('#date-selector .date-btn', { timeout: 10000 });
        await p.screenshot({ path: path.join(SHOTS, 'e2e-booking-' + name + '.png') });
      }
    }
    ok = true;
  } catch (e) {
    if (errors.length) console.log('Lỗi JavaScript trên trang:', errors.join(' | '));
  } finally {
    await browser.close();
    srv.stop();
  }
  for (const [s, name, ms] of steps) console.log(s, name, ms != null ? `(${ms} ms)` : '');
  console.log(ok ? '\n✓ Luồng đặt vé trọn vẹn chạy đúng trên trình duyệt' : '\n✗ Kiểm thử e2e LỖI');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
