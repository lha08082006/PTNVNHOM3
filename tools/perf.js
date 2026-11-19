// tools/perf.js - Đo nhanh tốc độ trang (Đợt 5): dung lượng tải, ảnh, LCP, CLS trên điện thoại giả lập 4G
// Chạy (server đang chạy): node tools/perf.js http://localhost:5017 [home schedule ...]
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:5000';
const PAGES = process.argv.slice(3).length ? process.argv.slice(3) : ['home', 'schedule', 'tin-tuc', 'gia-ve', 'bap-nuoc'];
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|youtube|ytimg/;

(async () => {
  const b = await puppeteer.launch({ executablePath: exe, headless: true });
  const rows = [];
  for (const name of PAGES) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const cdp = await p.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await p.setRequestInterception(true);
    p.on('request', r => EXTERNAL.test(r.url()) ? r.abort() : r.continue());
    let bytes = 0, img = 0, reqs = 0;
    cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; reqs++; });
    const types = {};
    cdp.on('Network.responseReceived', e => { types[e.requestId] = e.type; });
    cdp.on('Network.loadingFinished', e => { if (types[e.requestId] === 'Image') img += e.encodedDataLength; });
    await p.evaluateOnNewDocument(() => {
      window.__lcp = 0; window.__cls = 0;
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    const t0 = Date.now();
    await p.goto(BASE + '/' + name + '.html', { waitUntil: 'networkidle2', timeout: 60000 });
    const load = Date.now() - t0;
    await new Promise(r => setTimeout(r, 500));
    const m = await p.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Math.round(window.__cls * 1000) / 1000 }));
    rows.push({ page: name, KB: Math.round(bytes / 1024), image_KB: Math.round(img / 1024), requests: reqs, LCP_ms: m.lcp, CLS: m.cls, load_ms: load });
    await ctx.close();
  }
  await b.close();
  console.table(rows);
})().catch(e => { console.error(e); process.exit(1); });
