// server.js - Máy chủ phát triển (Static files trong public/ + API kiểu Vercel trong api/)
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_DIR = path.join(__dirname, 'api');

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
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Giống redirects trong vercel.json
const REDIRECTS = {
  '/login': '/auth.html#login',
  '/login.html': '/auth.html#login',
  '/register': '/auth.html#register',
  '/register.html': '/auth.html#register'
};

// Tự động đăng ký mọi file api/*.js thành /api/<tên-file>
const apiRoutes = {};
fs.readdirSync(API_DIR).filter(f => f.endsWith('.js')).forEach(f => {
  apiRoutes['/api/' + f.replace(/\.js$/, '')] = require(path.join(API_DIR, f));
});

function sendNotFound(res, pathname) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<h2>404 - Không tìm thấy trang: ${pathname.replace(/[<>&"]/g, '')}</h2><p><a href="/">Quay về trang chủ</a></p>`);
}

function handleApi(req, res, pathname, query) {
  const handler = apiRoutes[pathname];
  if (!handler) {
    res.status(404).json({ error: 'API Endpoint không tồn tại: ' + pathname });
    return;
  }
  req.query = query;

  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk; });
  req.on('end', async () => {
    try {
      req.body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      req.body = {};
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[Server API Error ${pathname}]:`, err);
      if (!res.writableEnded) res.status(500).json({ error: err.message || 'Lỗi xử lý server' });
    }
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch (e) {
    return sendNotFound(res, pathname);
  }
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));

  // Chặn truy cập ra ngoài thư mục public/ (path traversal)
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendNotFound(res, pathname);
  }

  // Clean URLs: /checkout -> /checkout.html
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) filePath += '.html';

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) return sendNotFound(res, pathname);

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    // HTML luôn lấy bản mới; ảnh/CSS/JS cho trình duyệt cache 1 giờ
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  // Helper res.status() / res.json() tương thích Vercel
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (data) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(data));
    return this;
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (REDIRECTS[pathname]) {
    res.statusCode = 302;
    res.setHeader('Location', REDIRECTS[pathname]);
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname, Object.fromEntries(searchParams));
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('=======================================================');
  console.log(`🎬 BETA CINEMAS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`📦 API: ${Object.keys(apiRoutes).join(', ')}`);
  console.log('=======================================================');
});
