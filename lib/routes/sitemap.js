// lib/routes/sitemap.js (phục vụ tại /api/sitemap) - sitemap.xml và robots.txt cho công cụ tìm kiếm (/sitemap.xml, /robots.txt được rewrite về đây).
// Trang công khai + trang chi tiết từng phim đang chiếu / sắp chiếu lấy từ database.
const CatalogDB = require('../catalog-db');

const STATIC = ['/', '/schedule', '/booking', '/rap', '/gia-ve', '/tin-tuc', '/bap-nuoc', '/thue-rap', '/support', '/policy'];
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// Tên miền lấy theo chính yêu cầu (đúng domain đang chạy, kể cả khi SITE_URL còn để domain cũ); thiếu thì mới dùng SITE_URL
function siteUrl(req) {
  const fromEnv = String(process.env.SITE_URL || '').replace(/\/+$/, '');
  const h0 = req.headers && (req.headers['x-forwarded-host'] || req.headers.host);
  if (!h0 && fromEnv) return fromEnv;
  const h = h0 || 'localhost';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || (/^(localhost|127\.)/.test(h) ? 'http' : 'https');
  return proto + '://' + h;
}

const ROBOTS_DISALLOW = ['/api/', '/admin', '/account', '/checkout', '/gateway', '/ticket', '/order', '/invoice', '/showcase', '/offline'];

module.exports = async function handler(req, res) {
  const base = siteUrl(req);
  if (req.query && req.query.robots) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.statusCode = 200;
    // Website demo đồ án: không cho công cụ tìm kiếm lập chỉ mục (kèm header X-Robots-Tag: noindex trong vercel.json).
    // Bản chính thức muốn lên Google thì đặt ALLOW_INDEXING=1.
    const lines = process.env.ALLOW_INDEXING === '1'
      ? ['User-agent: *', 'Allow: /'].concat(ROBOTS_DISALLOW.map((p) => 'Disallow: ' + p), ['Sitemap: ' + base + '/sitemap.xml'])
      : ['User-agent: *', 'Disallow: /'];
    return res.end(lines.join('\n') + '\n');
  }
  let movies = [];
  try { movies = (await CatalogDB.movies()).filter((m) => m.status !== 'HIDDEN'); } catch (e) { /* vẫn trả trang tĩnh */ }
  let cinemas = [];
  try { cinemas = await CatalogDB.cinemas(); } catch (e) { /* vẫn trả trang tĩnh */ }
  let posts = [];
  try { posts = await require('../posts').list({ limit: 50 }); } catch (e) { /* vẫn trả trang tĩnh */ }
  const urls = STATIC.map((p) => base + p)
    .concat(movies.map((m) => base + '/phim/' + encodeURIComponent(m.key)))
    .concat(cinemas.map((c) => base + '/rap?id=' + encodeURIComponent(c.id)))
    .concat(posts.map((p) => base + '/tin-tuc?id=' + encodeURIComponent(p.id)));
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + xml(u) + '</loc></url>').join('\n') + '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.statusCode = 200;
  res.end(body);
};
