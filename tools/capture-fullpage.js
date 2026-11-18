// capture-fullpage.js
// Chụp toàn bộ chiều dài trang web (Full Page / Full Height từ Header đến Footer)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = path.join(__dirname, '..', 'mockups-png');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const SCREENS = [
  'home.html',
  'movie-detail.html',
  'schedule.html',
  'booking.html',
  'seats.html',
  'combo.html',
  'checkout.html',
  'gateway.html',
  'invoice.html',
  'ticket.html',
  'ticket-cancelled.html',
  'ticket-refunded.html',
  'underpay.html',
  'overpay.html',
  'refund.html',
  'refund-track.html',
  'auth.html',
  'login.html',
  'register.html',
  'verify.html',
  'account.html',
  'support.html',
  'betabot.html'
];

async function captureAll() {
  console.log('🚀 Đang khởi động Chrome để chụp Full Page (toàn bộ chiều dài trang)...');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars'
    ]
  });

  const page = await browser.newPage();
  
  // Set viewport Desktop 1440px, deviceScaleFactor 2 để ảnh siêu nét Retina
  await page.setViewport({
    width: 1440,
    height: 900,
    deviceScaleFactor: 2
  });

  for (let i = 0; i < SCREENS.length; i++) {
    const screen = SCREENS[i];
    const url = `${BASE_URL}/${screen}`;
    const outputFileName = screen.replace(/\.html$/, '.png');
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    try {
      console.log(`[${i + 1}/${SCREENS.length}] Đang chụp: ${screen}...`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Chờ thêm 1 giây để các script tính toán xong vị trí và render ảnh
      await new Promise(r => setTimeout(r, 1000));

      // Chụp Full Page từ đầu đến chân trang (Footer)
      await page.screenshot({
        path: outputPath,
        fullPage: true
      });

      console.log(`  ✅ Đã lưu: ${outputFileName}`);
    } catch (err) {
      console.error(`  ❌ Lỗi khi chụp ${screen}:`, err.message);
    }
  }

  await browser.close();
  console.log('🎉 Hoàn thành xuất 23 ảnh Full Page vào thư mục mockups-png!');
}

captureAll();
