// sw.js - Service worker PWA (Đợt 2)
//   - Trang (HTML): lấy mạng trước, mất mạng thì dùng bản đã lưu; không có thì mở offline.html (vé đã lưu)
//   - CSS / JS / ảnh: dùng bản đã lưu ngay, đồng thời tải bản mới về cho lần sau
//   - /api/*: KHÔNG lưu (đơn, thanh toán luôn lấy trực tiếp; vé offline do pay-client.js lưu ở localStorage)
// Vercel bật cleanUrls (/ticket.html -> /ticket) nên trang được lưu theo khóa đã chuẩn hóa: bỏ ".html", "/" = "/home".
// Đổi VERSION khi đổi danh sách PRECACHE để xóa bộ nhớ đệm cũ.
const VERSION = 'beta-v7'; // CSP bỏ 'unsafe-inline': mã từng trang chuyển ra js/<trang>.js (lưu sẵn cho trang dùng offline)
const PAGES = ['/home.html', '/account.html', '/ticket.html', '/order.html', '/offline.html'];
const ASSETS = [
  '/css/prototype-theme.css', '/css/icons.css',
  '/catalog.js', '/pay-client.js', '/auth-client.js', '/site-chrome.js', '/quick-dock.js', '/lang.js', '/i18n/en.json',
  '/images/logo-white-official.png', '/images/logo-official.png', '/images/pwa-192.png', '/images/icon-ticket.png',
  '/barcode.js',
  // Mã của các trang trong PAGES (không có thì mất mạng mở trang ra cũng không chạy)
  '/js/actions.js', '/js/home.js', '/js/home-catalog.js', '/js/account.js', '/js/ticket.js', '/js/order.js', '/js/offline.js'
];

const pageKey = (pathname) => {
  const p = pathname.replace(/\.html$/, '').replace(/\/+$/, '');
  return p === '' ? '/home' : p;
};
// Bỏ cờ "redirected" (trình duyệt không cho dùng phản hồi đã chuyển hướng làm trang điều hướng)
const plain = async (res) => new Response(await res.blob(), { status: 200, headers: res.headers });

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // Từng file một: thiếu một file không làm hỏng cả bước cài đặt
    await Promise.all(PAGES.map(async (u) => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(pageKey(u), await plain(r)); } catch (err) { /* bỏ qua */ }
    }));
    await Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && url.pathname.startsWith('/api/')) return; // dữ liệu động: luôn đi mạng
  if (same && /^\/(admin(\.html)?|sw\.js)$/.test(url.pathname)) return; // trang nội bộ không lưu

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const key = pageKey(url.pathname);
      try {
        const res = await fetch(req);
        if (res.ok && same) { const c = await caches.open(VERSION); c.put(key, await plain(res.clone())); }
        return res;
      } catch (err) {
        const c = await caches.open(VERSION);
        return (await c.match(key)) || (await c.match('/offline')) || new Response('Mất kết nối mạng', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // js/<trang>.js đi đôi với HTML của trang (trước là <script> viết thẳng trong trang) -> lấy mạng trước như trang,
  // để HTML mới không chạy với mã cũ đã lưu; mất mạng mới dùng bản đã lưu
  if (same && url.pathname.startsWith('/js/')) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await c.match(req)) || new Response('', { status: 504 });
      }
    })());
    return;
  }

  const cdn = url.hostname === 'cdnjs.cloudflare.com';
  if (!same && !cdn) return;
  if (!/\.(css|js|json|png|jpe?g|webp|svg|gif|woff2?)$/i.test(url.pathname)) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    let hit = await c.match(req);
    // Thư viện ngoài nay nạp kèm crossorigin + integrity: bản "opaque" cũ (nạp không CORS) không dùng được nữa -> lấy mạng
    if (hit && hit.type === 'opaque' && req.mode !== 'no-cors') hit = null;
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});
