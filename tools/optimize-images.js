// tools/optimize-images.js - Đổi ảnh PNG/JPG lớn sang WebP (Đợt 5) bằng Chrome không giao diện (không cần cài thêm thư viện)
// Chạy: node tools/optimize-images.js        (chỉ in kết quả, không ghi)
//       node tools/optimize-images.js --write (ghi file .webp và đổi đường dẫn trong mã nguồn)
// - Chỉ xử lý ảnh >= 40 KB; chỉ dùng bản WebP khi nhỏ hơn bản gốc >= 25%.
// - Ảnh rộng hơn 1800 px được thu về 1800 px.
// - GIỮ file gốc: dữ liệu cũ trong database (vd poster phim) vẫn trỏ được tới ảnh cũ.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'images');
const WRITE = process.argv.includes('--write');
const MAX_W = 1800, MIN_BYTES = 40 * 1024, GAIN = 0.25, QUALITY = 0.8;
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
const MIME = (buf) => buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'application/octet-stream';
// Các tệp mã nguồn có thể nhắc tới ảnh
const SOURCES = () => fs.readdirSync(ROOT).filter(f => /\.(html|js|json|css)$/.test(f)).map(f => path.join(ROOT, f))
  .concat(['lib', 'css', 'i18n'].flatMap(d => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter(f => /\.(js|css|json)$/.test(f)).map(f => path.join(ROOT, d, f)) : []));

(async () => {
  const files = fs.readdirSync(IMG).filter(f => /\.(png|jpe?g)$/i.test(f) && fs.statSync(path.join(IMG, f)).size >= MIN_BYTES && !/^(pwa-|apple-touch|icon-|logo)/.test(f));
  const b = await puppeteer.launch({ executablePath: exe, headless: true });
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  let before = 0, after = 0;
  const swaps = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(IMG, f));
    const type = MIME(buf);
    if (type === 'image/webp' || type === 'application/octet-stream') { console.log('bỏ qua (đã là webp / không rõ):', f); continue; }
    const out = await p.evaluate(async (src, maxW, q) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/webp', q).split(',')[1], w: c.width, h: c.height };
    }, `data:${type};base64,${buf.toString('base64')}`, MAX_W, QUALITY);
    const webp = Buffer.from(out.data, 'base64');
    const ok = webp.length <= buf.length * (1 - GAIN);
    console.log(`${ok ? '✓' : '·'} ${f}: ${(buf.length / 1024).toFixed(0)} KB -> ${(webp.length / 1024).toFixed(0)} KB (${out.w}x${out.h})`);
    before += buf.length; after += ok ? webp.length : buf.length;
    if (ok) {
      const name = f.replace(/\.(png|jpe?g)$/i, '.webp');
      if (fs.existsSync(path.join(IMG, name)) && !WRITE) { /* đã có */ }
      if (WRITE) fs.writeFileSync(path.join(IMG, name), webp);
      swaps.push([f, name]);
    }
  }
  // Bản nhỏ cho điện thoại: ảnh rộng > 1200 px -> thêm "<tên>-800w.webp" (dùng trong srcset)
  for (const f of fs.readdirSync(IMG).filter(x => /\.(webp|png|jpe?g)$/i.test(x) && !/-800w\.webp$/.test(x))) {
    const small = f.replace(/\.(webp|png|jpe?g)$/i, '-800w.webp');
    if (fs.existsSync(path.join(IMG, small))) continue;
    const buf = fs.readFileSync(path.join(IMG, f));
    const type = MIME(buf);
    if (type === 'application/octet-stream') continue;
    const out = await p.evaluate(async (src, q) => {
      const img = new Image(); img.src = src; await img.decode();
      if (img.naturalWidth <= 1200) return null;
      const c = document.createElement('canvas');
      c.width = 800; c.height = Math.round(img.naturalHeight * 800 / img.naturalWidth);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', q).split(',')[1];
    }, `data:${type};base64,${buf.toString('base64')}`, QUALITY);
    if (!out) continue;
    console.log(`+ ${small}: ${(Buffer.from(out, 'base64').length / 1024).toFixed(0)} KB (bản 800px cho điện thoại)`);
    if (WRITE) fs.writeFileSync(path.join(IMG, small), Buffer.from(out, 'base64'));
  }
  await b.close();
  console.log(`Tổng: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB`);
  if (!WRITE) return console.log('(chạy thêm --write để ghi file và đổi đường dẫn)');
  let changed = 0;
  for (const src of SOURCES()) {
    let s = fs.readFileSync(src, 'utf8');
    const orig = s;
    for (const [from, to] of swaps) s = s.split('images/' + from).join('images/' + to);
    if (s !== orig) { fs.writeFileSync(src, s); changed++; console.log('đổi đường dẫn:', path.relative(ROOT, src)); }
  }
  console.log('Đã đổi', changed, 'tệp mã nguồn.');
})().catch(e => { console.error(e); process.exit(1); });
