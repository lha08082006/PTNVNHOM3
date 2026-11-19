// tools/page-test.js - Kiểm thử giao diện: mọi trang mở không lỗi JS, không tràn ngang trên điện thoại.
// Chạy: npm run test:pages   (cần Chrome/Edge; đặt CHROME_PATH nếu không tự tìm thấy - không có thì bỏ qua)
// Ý tưởng lấy từ tests/e2e.test.js của nhánh GitHub, viết lại bằng puppeteer-core cho kiến trúc hiện tại.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|qr\.sepay\.vn|img\.vietqr|youtube\.com|ytimg\.com|unpkg\.com|cdnjs|jsdelivr/;
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !['showcase.html'].includes(f));

function findChrome() {
  const list = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  return list.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
}
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); s.on('error', no); });

async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_MODE: 'mock' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('Server không khởi động được')), 15000);
    proc.stdout.on('data', d => { if (String(d).includes('ĐANG CHẠY')) { clearTimeout(timer); ok(); } });
    proc.on('exit', c => no(new Error('Server thoát sớm, mã ' + c)));
  });
  return { url: `http://localhost:${port}/`, stop: () => proc.kill() };
}

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.log('Bỏ qua kiểm thử giao diện: không tìm thấy Chrome/Edge (đặt CHROME_PATH).'); return; }
  const puppeteer = require('puppeteer-core');
  const srv = await startServer();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const fails = [];
  try {
    for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 375, height: 812, isMobile: true, hasTouch: true }]]) {
      for (const file of PAGES) {
        const page = await browser.newPage();
        await page.setViewport(vp);
        // PAGE_LANG=en: kiểm tra giao diện tiếng Anh (chữ dài hơn dễ tràn)
        if (process.env.PAGE_LANG) await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('BETA_LANG', l); } catch (e) {} }, process.env.PAGE_LANG);
        await page.setRequestInterception(true);
        page.on('request', r => EXTERNAL.test(r.url()) ? r.abort() : r.continue());
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        // Header bảo mật (CSP) chặn nhầm tài nguyên của chính web -> coi là lỗi
        page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to (load|execute|connect|frame|apply)/i.test(m.text())) errs.push('CSP: ' + m.text().slice(0, 200)); });
        page.on('dialog', d => d.dismiss());
        try {
          await page.goto(srv.url + file, { waitUntil: 'networkidle2', timeout: 20000 });
          await new Promise(r => setTimeout(r, 300));
          if (errs.length) fails.push(`${label} ${file}: lỗi JS – ${errs[0]}`);
          if (label === 'mobile') {
            const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            if (over > 2) fails.push(`${label} ${file}: tràn ngang ${over}px`);
          }
        } catch (e) {
          fails.push(`${label} ${file}: không tải được – ${e.message}`);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(`Đã mở ${PAGES.length} trang × 2 kích thước màn hình.`);
  if (fails.length) { fails.forEach(f => console.log('✗', f)); process.exit(1); }
  console.log('✓ Không lỗi JS, không tràn ngang trên điện thoại');
})().catch(e => { console.error(e); process.exit(1); });
