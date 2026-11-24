// tools/page-test.js - Kiểm thử giao diện: mọi trang mở không lỗi JS, không tràn ngang trên điện thoại.
// Chạy: npm run test:pages   (cần Chrome/Edge; đặt CHROME_PATH nếu không tự tìm thấy - không có thì bỏ qua)
// PAGE_BASE=https://<tên-miền> : kiểm tra thẳng web thật (chỉ mở trang xem, không gửi form) thay vì server bộ nhớ trong.
// Ý tưởng lấy từ tests/e2e.test.js của nhánh GitHub, viết lại bằng puppeteer-core cho kiến trúc hiện tại.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|qr\.sepay\.vn|img\.vietqr|youtube\.com|ytimg\.com|unpkg\.com|cdnjs|jsdelivr/;
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !['showcase.html'].includes(f));

// ---- CSP không có 'unsafe-inline' trong script-src: quét mã nguồn (chạy cả khi không có Chrome) ----
// Cấm: <script> viết thẳng trong HTML, thuộc tính on*="..." (cả trong chuỗi HTML do JS dựng), href="javascript:...".
// Thay bằng js/<trang>.js và data-on-click="ham(...)" (js/actions.js). Mọi data-on-* phải đọc được.
const Actions = require('../js/actions.js');
const ON_ATTR = /(^|[\s"'`\\])on([a-z]+)\s*=\s*\\?["']/g;
const JS_URL = /(href|src|action)\s*=\s*\\?["']\s*javascript:/i;
const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
// Giá trị data-on-*="..." trong một tệp: [{ line, code }] - trong JS thì ${...} thay bằng giá trị mẫu
function dataOnValues(s, inJs) {
  const out = [], re = /data-on-[a-z]+=(\\?)(["'])/g;
  let m;
  while ((m = re.exec(s))) {
    const close = m[1] + m[2];
    let d = 0, k = re.lastIndex;
    for (; k < s.length; k++) {
      if (s[k] === '$' && s[k + 1] === '{') { d++; k++; continue; }
      if (d && s[k] === '{') { d++; continue; }
      if (d && s[k] === '}') { d--; continue; }
      if (!d && s.startsWith(close, k)) break;
    }
    let body = s.slice(re.lastIndex, k), code = '', q = null;
    if (/^\$\{[^}]*\}$/.test(body)) { re.lastIndex = k; continue; } // cả giá trị do JS ghép (vd. ${go}): chỉ kiểm được lúc chạy
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '$' && body[i + 1] === '{') { let n = 0, j = i; for (; j < body.length; j++) { if (body[j] === '{') n++; else if (body[j] === '}' && !--n) break; } code += q ? 'X' : '0'; i = j; continue; }
      if (c === '\\' && inJs) { const e = body[++i]; if (e === "'" || e === '"') { if (!q) q = e; else if (q === e) q = null; } code += e; continue; }
      if (c === "'" || c === '"') { if (!q) q = c; else if (q === c) q = null; }
      code += c;
    }
    out.push({ line: lineOf(s, m.index), code: decodeHtml(code) });
    re.lastIndex = k;
  }
  return out;
}
const pageScripts = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="\/?([^"]+)"/g)].map(m => m[1]).filter(src => !/^https?:/.test(src));
function staticCsp() {
  const errs = [];
  const htmls = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const scripts = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !['support.js', 'sw.js'].includes(f))
    .concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
  const callees = {}; // tệp -> tên hàm được gọi từ data-on-*
  for (const f of htmls.concat(scripts)) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const isHtml = f.endsWith('.html');
    if (isHtml) {
      for (const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1]) && /\S/.test(m[2])) errs.push(`${f}:${lineOf(s, m.index)}: còn <script> viết thẳng trong HTML -> chuyển ra js/<trang>.js`);
      }
    }
    for (const m of s.matchAll(ON_ATTR)) errs.push(`${f}:${lineOf(s, m.index)}: thuộc tính on${m[2]}= bị CSP chặn -> dùng data-on-${m[2]}="..."`);
    const jsu = JS_URL.exec(s);
    if (jsu) errs.push(`${f}:${lineOf(s, jsu.index)}: liên kết javascript: bị CSP chặn`);
    const set = callees[f] = new Set();
    if (f === 'js/actions.js') continue; // chú thích hướng dẫn có ví dụ data-on-*
    for (const v of dataOnValues(s, !isHtml)) {
      try {
        Actions.parse(v.code).forEach(st => { if (st.call && st.call[0] !== 'event') set.add(st.call.join('.')); });
      } catch (e) { errs.push(`${f}:${v.line}: data-on-*="${v.code}" – ${e.message}`); }
    }
    if (isHtml && (set.size || /data-fallback=/.test(s)) && !pageScripts(s).includes('js/actions.js')) errs.push(`${f}: có data-on-* / data-fallback nhưng chưa nạp js/actions.js`);
  }
  // Hàm cần có trên từng trang = gọi trong HTML + trong các js/<...>.js trang đó nạp
  const need = {};
  for (const f of htmls) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    need[f] = [...new Set([...callees[f], ...pageScripts(html).flatMap(src => [...(callees[src] || [])])])];
  }
  return { errs, need };
}

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
  const csp = staticCsp();
  if (csp.errs.length) { csp.errs.forEach(e => console.log('✗ CSP', e)); console.log(`✗ ${csp.errs.length} chỗ vi phạm CSP trong mã nguồn`); process.exit(1); }
  console.log('✓ CSP: không còn script inline / on*= / javascript: trong mã nguồn; mọi data-on-* đọc được');
  const chrome = findChrome();
  if (!chrome) { console.log('Bỏ qua kiểm thử giao diện: không tìm thấy Chrome/Edge (đặt CHROME_PATH).'); return; }
  const puppeteer = require('puppeteer-core');
  const srv = process.env.PAGE_BASE ? { url: process.env.PAGE_BASE.replace(/\/*$/, '/'), stop: () => {} } : await startServer();
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
        // Header bảo mật (CSP) chặn script inline / on*= / javascript: hay tài nguyên của chính web -> coi là lỗi
        page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to (load|execute|run|connect|frame|apply|evaluate|create)/i.test(m.text())) errs.push('CSP: ' + m.text().slice(0, 200)); });
        // Bắt cả vi phạm CSP không in ra console (sự kiện securitypolicyviolation)
        await page.evaluateOnNewDocument(() => {
          document.addEventListener('securitypolicyviolation', (e) => {
            (window.__cspViolations = window.__cspViolations || []).push(`${e.violatedDirective} chặn ${e.blockedURI || '?'}${e.sourceFile ? ' tại ' + e.sourceFile.split('/').pop() + ':' + e.lineNumber : ''}`);
          });
        });
        page.on('dialog', d => d.dismiss());
        try {
          await page.goto(srv.url + file, { waitUntil: 'networkidle2', timeout: process.env.PAGE_BASE ? 60000 : 20000 });
          await new Promise(r => setTimeout(r, 300));
          // Trang chuyển hướng (login -> auth, ticket-cancelled -> account...) thì không kiểm hàm của trang gốc
          const landed = new URL(page.url()).pathname.replace(/^\/+/, '').replace(/\.html$/, '') || 'home';
          const need = label === 'desktop' && landed === file.replace(/\.html$/, '') ? csp.need[file] : [];
          errs.push(...await page.evaluate((need) => {
            const out = (window.__cspViolations || []).map(v => 'CSP: ' + v);
            // on*= / javascript: còn sót trong DOM (kể cả phần JS dựng lúc tải trang) – bị chặn khi người dùng bấm
            for (const el of document.querySelectorAll('*')) {
              const a = [...el.attributes].find(x => /^on/i.test(x.name));
              if (a) { out.push(`CSP: <${el.tagName.toLowerCase()} ${a.name}="${a.value.slice(0, 60)}"> sẽ bị chặn`); break; }
            }
            if (document.querySelector('[href^="javascript:" i]')) out.push('CSP: còn liên kết javascript:');
            if (window.BetaActions) out.push(...window.BetaActions.check());
            else if (need.length) out.push('data-on-*: trang chưa nạp js/actions.js');
            for (const name of need) {
              const parts = name.split('.');
              let cur = window;
              for (const p of parts[0] === 'window' ? parts.slice(1) : parts) cur = cur == null ? undefined : cur[p];
              if (typeof cur !== 'function') out.push(`data-on-*: không có hàm ${name} trên window (khai báo const/let thì gán thêm window.${parts[0]} = ${parts[0]})`);
            }
            return out;
          }, need));
          if (errs.length) errs.slice(0, 6).forEach((e, i) => fails.push(`${label} ${file}: lỗi JS – ${e}${i === 5 && errs.length > 6 ? ` (+${errs.length - 6} lỗi khác)` : ''}`));
          if (label === 'mobile') {
            const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            if (over > 2) fails.push(`${label} ${file}: tràn ngang ${over}px`);
            // Đợt 8: trang có đầu trang chuẩn -> gọn 1 hàng (≤ 72px), có nút ☰, menu ngang ẩn
            const hdr = await page.evaluate(() => {
              const h = document.querySelector('.header-main-official');
              if (!h) return null;
              const b = h.querySelector('.hdr-burger'), nav = h.querySelector('nav');
              return { h: Math.round(h.getBoundingClientRect().height), burger: !!b && getComputedStyle(b).display !== 'none', nav: !!nav && getComputedStyle(nav).display !== 'none' };
            });
            if (hdr && (hdr.h > 72 || !hdr.burger || hdr.nav)) fails.push(`${label} ${file}: đầu trang điện thoại chưa gọn – ${JSON.stringify(hdr)}`);
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
