// lib/routes/movie-page.js (phục vụ /phim/<mã-phim>, Vercel rewrite -> /api/movie-page?slug=) - Đợt 5
// Trả trang movie-detail.html đã chèn sẵn ở <head>: tiêu đề, mô tả, ảnh chia sẻ (Open Graph), đường dẫn chuẩn
// và dữ liệu có cấu trúc schema.org Movie. Facebook / Zalo / Google đọc được ngay mà không cần chạy JavaScript.
// Phần thân trang vẫn do JavaScript vẽ như cũ.
const fs = require('fs');
const path = require('path');
const CatalogDB = require('../catalog-db');

let TEMPLATE = null;
function template() {
  if (TEMPLATE) return TEMPLATE;
  for (const p of [path.join(process.cwd(), 'movie-detail.html'), path.join(__dirname, '..', '..', 'movie-detail.html')]) {
    try { TEMPLATE = fs.readFileSync(p, 'utf8'); return TEMPLATE; } catch (e) { /* thử đường dẫn khác */ }
  }
  throw new Error('Không đọc được movie-detail.html');
}
const attr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function site(req) {
  const fromEnv = String(process.env.SITE_URL || '').replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const h = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost';
  return ((req.headers && req.headers['x-forwarded-proto']) || (/^(localhost|127\.)/.test(h) ? 'http' : 'https')) + '://' + h;
}

function render(html, m, base) {
  const url = base + '/phim/' + encodeURIComponent(m.key);
  const desc = String(m.synopsis || m.meta || ('Lịch chiếu và đặt vé phim ' + m.title + ' tại Beta Cinemas.')).replace(/\s+/g, ' ').trim().slice(0, 160);
  const img = m.poster ? (/^https?:/.test(m.poster) ? m.poster : base + '/' + String(m.poster).replace(/^\//, '')) : base + '/images/logo-official.png';
  const ld = {
    '@context': 'https://schema.org', '@type': 'Movie', name: m.title, url, image: img, description: desc,
    ...(m.duration_min ? { duration: 'PT' + m.duration_min + 'M' } : {}),
    ...(m.genre ? { genre: String(m.genre).split(/,\s*/) } : {}),
    ...(m.director ? { director: { '@type': 'Person', name: m.director } } : {}),
    ...(m.cast ? { actor: String(m.cast).split(/,\s*/).slice(0, 6).map(n => ({ '@type': 'Person', name: n })) } : {}),
    ...(m.release_date ? { datePublished: m.release_date } : {}),
    ...(m.age ? { contentRating: m.age } : {})
  };
  const title = m.title + ' - Lịch chiếu & đặt vé | Beta Cinemas';
  return html
    .replace(/<title>[^<]*<\/title>/, '<title>' + attr(title) + '</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + attr(desc) + '">')
    .replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="video.movie">')
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + attr(m.title + ' - Beta Cinemas') + '">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + attr(desc) + '">')
    .replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + attr(img) + '">\n  <meta property="og:url" content="' + attr(url) + '">\n  <link rel="canonical" href="' + attr(url) + '">\n  <script type="application/ld+json" id="ld-movie">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>');
}

module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  let html = template();
  let status = 404;
  try {
    if (/^[a-z0-9-]{1,80}$/.test(slug)) {
      const m = (await CatalogDB.movies()).find(x => x.key === slug && x.status !== 'HIDDEN');
      if (m) { html = render(html, m, site(req)); status = 200; }
    }
  } catch (e) { console.warn('[movie-page]', e.message); status = 200; /* lỗi DB: vẫn trả trang, JavaScript tự tải */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' : 'no-store');
  res.statusCode = status;
  return res.end(html);
};
