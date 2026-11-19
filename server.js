// server.js - Máy chủ phát triển tích hợp (Static + Vercel-like Serverless API)
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Mọi API đi qua cùng một function như trên Vercel: api/[route].js → lib/routes/<tên>.js
const { routeOf } = require('./lib/routes');
const apiDispatch = require('./api/[route]');

const MAX_BODY_BYTES = 8 * 1024 * 1024; // đủ cho ảnh biên lai 5 MB (base64)

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Thêm helper status() và json() cho res tương thích Vercel
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (data) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(data));
    return this;
  };

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // 1. Xử lý API Routes
  // Giống rewrite trên Vercel: /sitemap.xml, /robots.txt do lib/routes/sitemap.js sinh ra
  if (pathname === '/sitemap.xml') pathname = '/api/sitemap';
  if (pathname === '/favicon.ico') pathname = '/images/icon-ticket.png';
  if (pathname === '/robots.txt') { pathname = '/api/sitemap'; parsedUrl.query = { ...(parsedUrl.query || {}), robots: '1' }; }

  if (pathname.startsWith('/api/')) {
    const name = pathname.slice('/api/'.length);
    const handler = routeOf(name) && apiDispatch;
    if (handler) {
      req.query = { ...parsedUrl.query, route: name };

      // Đọc JSON Body nếu có
      let rawBody = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        rawBody += chunk;
        if (rawBody.length > MAX_BODY_BYTES) {
          tooLarge = true;
          res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
        }
      });
      req.on('end', async () => {
        if (tooLarge) return;
        try {
          req.body = rawBody ? JSON.parse(rawBody) : {};
        } catch (e) {
          req.body = {};
        }

        try {
          await handler(req, res);
        } catch (err) {
          console.error(`[Server API Error ${pathname}]:`, err);
          if (!res.writableEnded) {
            res.status(500).json({ error: err.message || 'Lỗi xử lý server' });
          }
        }
      });
      return;
    } else {
      res.status(404).json({ error: 'API Endpoint không tồn tại: ' + pathname });
      return;
    }
  }

  // 2. Xử lý Static Files (HTML, CSS, JS, Images)
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname === '/' ? 'home.html' : pathname));
  // Không phục vụ tệp ẩn (.env, .git...) hay tệp nằm ngoài thư mục dự án
  const rel = path.relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || rel.split(path.sep).some(p => p.startsWith('.')) || /^(lib|api|node_modules)([\\/]|$)/.test(rel)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  // Clean URLs: Hỗ trợ truy cập không cần gõ .html (VD: /checkout -> /checkout.html)
  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      fs.createReadStream(path.join(PUBLIC_DIR, '404.html')).pipe(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    // Chạy thử trên máy: luôn lấy bản mới của HTML/JS/CSS để sửa code là thấy ngay (ảnh vẫn cho lưu đệm)
    res.setHeader('Cache-Control', ['.html', '.js', '.css', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=3600');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 BETA CINEMAS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`💳 Webhook SePay: POST /api/sepay-webhook · Trang nội bộ: /admin.html`);
  console.log(`=======================================================`);
});

// Job nền khi chạy local: Tầng 1 tra cứu theo lịch (15 giây), Tầng 2 Job 30 phút/lần và gửi lại
// lệnh hoàn tiền (runJob tự kiểm tra đơn nào đến hạn). Trên Vercel dùng /api/cron + tra cứu khi đọc đơn.
const Flow = require('./lib/flow');
let jobRunning = false;
setInterval(async () => {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const r = await Flow.runJob();
    if (r.changed.length) console.log('[Job đối soát]', r.changed.join(' | '));
  } catch (e) {
    console.error('[Job đối soát lỗi]', e.message);
  } finally {
    jobRunning = false;
  }
}, 15 * 1000).unref();
