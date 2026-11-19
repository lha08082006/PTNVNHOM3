// tools/make-pwa-icons.js - Vẽ icon PWA (192, 512, maskable, apple-touch) từ SVG bằng Chrome/Edge không giao diện.
// Chạy lại khi đổi nhận diện: node tools/make-pwa-icons.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .filter(Boolean).find((p) => fs.existsSync(p));

// pad = true: icon "maskable" (Android cắt theo hình tròn/bo góc) -> nền tràn viền, chữ thu nhỏ vào vùng an toàn
const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#005198"/>
  <g transform="translate(256 256) scale(${pad ? 0.74 : 1}) translate(-256 -256)">
    <text x="256" y="292" text-anchor="middle" font-family="Montserrat, 'Segoe UI', Arial, sans-serif" font-weight="900" font-size="178" fill="#ffffff" letter-spacing="-4">beta</text>
    <rect x="128" y="326" width="256" height="22" rx="11" fill="#f7941d"/>
    <text x="256" y="402" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" font-size="44" fill="#cfe6ff" letter-spacing="10">CINEMAS</text>
  </g></svg>`;

(async () => {
  if (!exe) { console.log('Không tìm thấy Chrome/Edge (đặt CHROME_PATH)'); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  for (const [name, size, pad] of [['pwa-192.png', 192, false], ['pwa-512.png', 512, false], ['pwa-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, pad)}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, 'images', name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('images/' + name);
  }
  await browser.close();
})();
