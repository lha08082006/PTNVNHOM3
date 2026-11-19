// tools/i18n-extract.js - Gom các câu chữ tiếng Việt đang hiện trên trang khách (để dịch sang tiếng Anh)
// Chạy: (bật server ở PORT) node tools/i18n-extract.js http://localhost:5015 > scratch/vi-strings.json
//       thêm "en" ở cuối để mở trang ở chế độ tiếng Anh và liệt kê các câu tiếng Việt CÒN SÓT (chưa dịch)
// Mở từng trang (có đăng nhập, có đơn hàng mẫu), lấy chữ trong nút / nhãn / đoạn văn và các thuộc tính
// placeholder, aria-label, title, alt. Kết quả: danh sách chuỗi chưa có trong i18n/en.json.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:5015';
const MODE_EN = process.argv[3] === 'en';
const ROOT = path.join(__dirname, '..');
const PAGES = ['home', 'schedule', 'booking', 'gia-ve', 'tin-tuc', 'bap-nuoc', 'thue-rap', 'support', 'auth', 'account', 'account?tab=points', 'offline', '404'];
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

(async () => {
  const known = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8')).strings || {}; } catch (e) { return {}; } })();
  const b = await puppeteer.launch({ executablePath: exe, headless: true });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  p.on('dialog', d => d.dismiss());
  await p.goto(BASE + '/home.html', { waitUntil: 'networkidle2' });
  if (MODE_EN) await p.evaluate(() => localStorage.setItem('BETA_LANG', 'en'));
  // Trang đăng nhập / đăng ký khi CHƯA đăng nhập
  const before = ['auth', 'auth#register', 'login', 'register', 'support'];
  // Tài khoản + đơn đã thanh toán để các trang đơn / vé / phim có dữ liệu
  const ctx = await p.evaluate(async () => {
    const j = (u, o) => fetch(u, o).then(r => r.json());
    const reg = await j('/api/auth?action=register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Khach Dich', email: 'dich' + Date.now() + '@x.vn', phone: '09' + String(Date.now()).slice(-8), password: 'matkhau123', accept_terms: true }) });
    localStorage.setItem('BETA_AUTH_TOKEN', reg.token); localStorage.setItem('BETA_AUTH_USER', JSON.stringify(reg.user));
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token };
    const sts = (await j('/api/catalog?action=showtimes&days=7')).showtimes; const st = sts[sts.length - 1];
    const o = await j('/api/create-order', { method: 'POST', headers: H, body: JSON.stringify({ showtime_id: st.id, seats: ['C3'], combos: { solo: 1 } }) });
    const o2 = await j('/api/create-order', { method: 'POST', headers: H, body: JSON.stringify({ showtime_id: st.id, seats: ['C5'] }) });
    await j('/api/simulate-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'OK', order_code: o.code }) });
    return { st: st.id, movie: st.movie_key, paid: o.code, pending: o2.code };
  });
  const extra = [`seats?showtime=${ctx.st}`, `combo?showtime=${ctx.st}&seats=C7`, `checkout?showtime=${ctx.st}&seats=C7`, `gateway?order=${ctx.pending}`,
    `order?code=${ctx.paid}`, `ticket?order=${ctx.paid}`, `phim/${ctx.movie}`, 'movie-detail?movie=phim-khong-co'];
  const found = new Map();
  const visit = before.map(x => '!' + x).concat(PAGES, extra);
  for (let path_ of visit) {
    if (path_.startsWith('!')) {
      path_ = path_.slice(1);
      await p.evaluate(() => { const t = localStorage.getItem('BETA_AUTH_TOKEN'); if (t) sessionStorage.setItem('T', t); localStorage.removeItem('BETA_AUTH_TOKEN'); localStorage.removeItem('BETA_AUTH_USER'); });
    } else {
      await p.evaluate(() => { const t = sessionStorage.getItem('T'); if (t && !localStorage.getItem('BETA_AUTH_TOKEN')) localStorage.setItem('BETA_AUTH_TOKEN', t); });
    }
    const [pp, hash] = path_.split('#');
    const url = BASE + '/' + (pp.startsWith('phim/') ? pp : pp.replace(/^([^?]+)/, '$1.html')) + (hash ? '#' + hash : '');
    try { await p.goto(url, { waitUntil: 'networkidle2', timeout: 20000 }); } catch (e) { continue; }
    await new Promise(r => setTimeout(r, 1200));
    // Mở các phần ẩn (tab, chi tiết) để lấy thêm chữ
    await p.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })).catch(() => {});
    const got = await p.evaluate(() => {
      const out = [];
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) ? 1 : 2 });
      let n; while ((n = w.nextNode())) { const t = norm(n.nodeValue); if (t) out.push(t); }
      document.querySelectorAll('[placeholder],[aria-label],[title],img[alt]').forEach(el => ['placeholder', 'aria-label', 'title', 'alt'].forEach(a => { const v = norm(el.getAttribute(a)); if (v) out.push(v); }));
      out.push(norm(document.title));
      return out;
    });
    for (const t of got) if (VI.test(t) && t.length <= 400 && (MODE_EN || !(t in known))) found.set(t, (found.get(t) || 0) + 1);
  }
  await b.close();
  process.stdout.write(JSON.stringify([...found.keys()].sort(), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
