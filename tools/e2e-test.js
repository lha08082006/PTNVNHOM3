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

    await step('Ngân hàng báo đã nhận tiền (sandbox) -> tự sang trang vé có mã QR', async () => {
      const r = await api('/api/simulate-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'OK', order_code: st.code }) });
      expect(r.status === 200, 'Sandbox lỗi: ' + JSON.stringify(r.data));
      await p.waitForFunction(() => /ticket\.html/.test(location.href), { timeout: 15000 });
      await p.waitForSelector('#ticket-qr canvas, #ticket-qr img', { timeout: 10000 });
      const tok = await p.evaluate(() => localStorage.getItem('BETA_AUTH_TOKEN'));
      const v = await api('/api/order-status?code=' + st.code, { headers: { Authorization: 'Bearer ' + tok } });
      expect(v.data.status === 'CONFIRMED' && v.data.combos.solo === 1 && v.data.seats.length === 2, 'Đơn sai: ' + JSON.stringify({ s: v.data.status, c: v.data.combos }));
      st.qr = v.data.ticket_qr;
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
      await a.type('#ck-input', st.qr);
      await a.keyboard.press('Enter');
      await a.waitForFunction(() => /HỢP LỆ|KHÔNG HỢP LỆ/.test(document.getElementById('ck-result').innerText), { timeout: 10000 });
      const first = await a.$eval('#ck-result', el => el.innerText);
      expect(/HỢP LỆ – MỜI VÀO/.test(first), 'Lần 1: ' + first.slice(0, 120));
      expect(/1 × Combo Solo|Ghế/.test(first), 'Thiếu thông tin ghế');
      await a.type('#ck-input', st.qr);
      await a.keyboard.press('Enter');
      await a.waitForFunction(() => /ĐÃ ĐƯỢC SOÁT/.test(document.getElementById('ck-result').innerText), { timeout: 10000 });
    });

    expect(!errors.length, 'Lỗi JavaScript: ' + errors.join(' | '));
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
