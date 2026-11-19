// tools/a11y-test.js - Kiểm tra tiếp cận (WCAG 2.1 A/AA) bằng axe-core trên các trang khách (Đợt 6)
// Chạy: npm run test:a11y         (lỗi mức "critical" / "serious" -> thất bại)
//       npm run test:a11y -- --all (in cả lỗi mức "moderate" / "minor" để sửa dần)
// Cần Chrome/Edge (đặt CHROME_PATH nếu không tự tìm thấy – không có thì bỏ qua).
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOW_ALL = process.argv.includes('--all');
const PAGES = ['home', 'schedule', 'gia-ve', 'tin-tuc', 'bap-nuoc', 'thue-rap', 'support', 'auth', 'policy', 'offline', 'account', 'phim/suzume', 'seats', 'checkout', 'order', 'ticket'];
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|qr\.sepay\.vn|img\.vietqr|youtube\.com|ytimg\.com/;
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); s.on('error', no); });

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

(async () => {
  if (!exe) { console.log('Bỏ qua kiểm tra tiếp cận: không tìm thấy Chrome/Edge (đặt CHROME_PATH).'); return; }
  const puppeteer = require('puppeteer-core');
  const AXE = require.resolve('axe-core/axe.min.js');
  const srv = await startServer();
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  let bad = 0;
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.setRequestInterception(true);
    p.on('request', r => EXTERNAL.test(r.url()) ? r.abort() : r.continue());
    p.on('dialog', d => d.dismiss());
    // Dữ liệu mẫu: tài khoản + một đơn đã thanh toán để các trang đơn / vé / chọn ghế có nội dung
    await p.goto(srv.url + '/home.html', { waitUntil: 'networkidle2' });
    const ctx = await p.evaluate(async () => {
      const j = (u, o) => fetch(u, o).then(r => r.json());
      const reg = await j('/api/auth?action=register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Khach A11y', email: 'a11y@x.vn', phone: '0908000111', password: 'matkhau123', accept_terms: true }) });
      localStorage.setItem('BETA_AUTH_TOKEN', reg.token); localStorage.setItem('BETA_AUTH_USER', JSON.stringify(reg.user));
      const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token };
      const sts = (await j('/api/catalog?action=showtimes&days=7')).showtimes; const st = sts[sts.length - 1];
      const o = await j('/api/create-order', { method: 'POST', headers: H, body: JSON.stringify({ showtime_id: st.id, seats: ['D4'] }) });
      await j('/api/simulate-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'OK', order_code: o.code }) });
      return { st: st.id, code: o.code };
    });
    const url = (name) => name === 'seats' ? '/seats.html?showtime=' + ctx.st : name === 'checkout' ? `/checkout.html?showtime=${ctx.st}&seats=D6` : name === 'order' ? '/order.html?code=' + ctx.code
      : name === 'ticket' ? '/ticket.html?order=' + ctx.code : name.startsWith('phim/') ? '/' + name : '/' + name + '.html';
    for (const name of PAGES) {
      await p.goto(srv.url + url(name), { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 700));
      await p.addScriptTag({ path: AXE });
      const res = await p.evaluate(async () => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 2).map(x => x.target.join(' ')).join(' | '),
          detail: v.id === 'color-contrast' ? v.nodes.map(x => { const d = (x.any[0] || {}).data || {}; return x.target.join(' ') + ' ' + d.fgColor + '/' + d.bgColor + ' ' + d.contrastRatio + ':1 (' + d.fontSize + (d.fontWeight >= 700 ? ' bold' : '') + ')'; }) : [] }));
      });
      const serious = res.filter(v => v.impact === 'critical' || v.impact === 'serious');
      bad += serious.length;
      const shown = SHOW_ALL ? res : serious;
      console.log(`${serious.length ? '✗' : '✓'} ${name}${res.length - serious.length ? ` (${res.length - serious.length} lỗi nhẹ${SHOW_ALL ? '' : ', xem bằng --all'})` : ''}`);
      for (const v of shown) {
        console.log(`    [${v.impact}] ${v.id} ×${v.n}: ${v.help}\n      ${v.sample}`);
        // --detail: màu chữ / nền và tỷ lệ tương phản của từng phần tử (để biết sửa màu nào)
        if (process.argv.includes('--detail')) (v.detail || []).forEach(d => console.log('        ' + d));
      }
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(bad ? `\n${bad} nhóm lỗi tiếp cận nghiêm trọng` : '\n✓ Không có lỗi tiếp cận mức nghiêm trọng (WCAG 2.1 AA)');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
