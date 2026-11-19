// server.js - Máy chủ phát triển tích hợp (Static + Vercel-like Serverless API)
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// Không bao giờ phục vụ mã nguồn server, cấu hình, bí mật dưới dạng file tĩnh
const BLOCKED_PREFIXES = ['api/', 'lib/', 'tests/', 'specs/', 'node_modules/'];
const BLOCKED_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'schema.sql', 'vercel.json']);
function isBlockedPath(relPath) {
  const parts = relPath.split('/');
  if (parts.some(p => p.startsWith('.'))) return true; // .env, .git, .claude, .specify ...
  if (BLOCKED_FILES.has(relPath)) return true;
  return BLOCKED_PREFIXES.some(prefix => relPath.startsWith(prefix));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Đăng ký các API handler
const apiRoutes = {
  '/api/orders': require('./api/orders'),
  '/api/create-order': require('./api/create-order'),
  '/api/order-status': require('./api/order-status'),
  '/api/sepay-webhook': require('./api/sepay-webhook'),
  '/api/reconcile': require('./api/reconcile'),
  '/api/refund': require('./api/refund'),
  '/api/simulate-payment': require('./api/simulate-payment')
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // 1. Xử lý API Routes
  if (pathname.startsWith('/api/')) {
    const handler = apiRoutes[pathname];
    if (handler) {
      req.query = parsedUrl.query;

      // Đọc JSON Body nếu có (giới hạn kích thước, JSON lỗi -> 400)
      let rawBody = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        rawBody += chunk;
        if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
          tooLarge = true;
          res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (tooLarge) return;
        try {
          req.body = rawBody ? JSON.parse(rawBody) : {};
        } catch (e) {
          res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
          return;
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
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }
  let filePath = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize(decoded === '/' ? '/index.html' : decoded));
  const relPath = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
  if (relPath.startsWith('..') || path.isAbsolute(relPath) || isBlockedPath(relPath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h2>404 - Không tìm thấy trang</h2><p><a href="/">Quay về trang chủ</a></p>');
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
      res.end(`<h2>404 - Không tìm thấy trang</h2><p><a href="/">Quay về trang chủ</a></p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

if (require.main !== module) {
  module.exports = server;
} else server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 BETA CINEMAS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`💳 Cổng thanh toán VietQR & Webhook SePay đã sẵn sàng!`);
  console.log(`=======================================================`);
});
