// tests/helpers.js - Khởi động server + trình duyệt dùng chung cho các bài kiểm thử
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
// Chặn tài nguyên bên ngoài để kiểm thử ổn định, không phụ thuộc mạng
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|qr\.sepay\.vn|img\.vietqr|youtube\.com|ytimg\.com/;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MOCK_DB: '1', SEPAY_API_KEY: 'test-webhook-key', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server không khởi động được')), 15000);
    proc.stdout.on('data', d => { if (String(d).includes('ĐANG CHẠY')) { clearTimeout(timer); resolve(); } });
    proc.on('exit', code => reject(new Error('Server thoát sớm, mã ' + code)));
  });
  return { url: `http://localhost:${port}/`, stop: () => proc.kill() };
}

async function launch() {
  return chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
}

// Tạo context mới (localStorage trống) + trang có ghi lại lỗi JS
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await ctx.route(EXTERNAL, r => r.abort());
  const page = await ctx.newPage();
  page.jsErrors = [];
  page.on('pageerror', e => page.jsErrors.push(e.message));
  page.on('dialog', d => d.accept());
  return page;
}

const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();

module.exports = { startServer, launch, newPage, text, ROOT };
