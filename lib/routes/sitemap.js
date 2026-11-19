// lib/routes/sitemap.js (phục vụ tại /api/sitemap) - sitemap.xml và robots.txt cho công cụ tìm kiếm (/sitemap.xml, /robots.txt được rewrite về đây).
// Trang công khai + trang chi tiết từng phim đang chiếu / sắp chiếu lấy từ database.
const CatalogDB = require('../catalog-db');

const STATIC = ['/', '/schedule', '/booking', '/gia-ve', '/support', '/policy'];
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function siteUrl(req) {
  const fromEnv = String(process.env.SITE_URL || '').replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const h = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || (/^(localhost|127\.)/.test(h) ? 'http' : 'https');
  return proto + '://' + h;
}

const ROBOTS_DISALLOW = ['/api/', '/admin', '/account', '/checkout', '/gateway', '/ticket', '/order', '/invoice', '/showcase'];

module.exports = async function handler(req, res) {
  const base = siteUrl(req);
  if (req.query && req.query.robots) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.statusCode = 200;
    const lines = ['User-agent: *', 'Allow: /'].concat(ROBOTS_DISALLOW.map((p) => 'Disallow: ' + p), ['Sitemap: ' + base + '/sitemap.xml']);
    return res.end(lines.join('\n') + '\n');
  }
  let movies = [];
  try { movies = (await CatalogDB.movies()).filter((m) => m.status !== 'HIDDEN'); } catch (e) { /* vẫn trả trang tĩnh */ }
  const urls = STATIC.map((p) => base + p)
    .concat(movies.map((m) => base + '/movie-detail?movie=' + encodeURIComponent(m.key)));
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + xml(u) + '</loc></url>').join('\n') + '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.statusCode = 200;
  res.end(body);
};
