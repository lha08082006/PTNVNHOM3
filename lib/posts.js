// lib/posts.js - Tin tức & ưu đãi (Quản lý đăng trên admin.html > Danh mục > Tin tức & ưu đãi)
// Nội dung là chữ thuần (không HTML) – trình duyệt tự xuống dòng theo đoạn, tránh chèn mã độc.
const Store = require('./store');
const CatalogDB = require('./catalog-db');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const TYPES = { PROMO: 'Ưu đãi', NEWS: 'Tin mới', EVENT: 'Sự kiện' };

const publicPost = (p) => p && ({
  id: p.id, title: p.title, summary: p.summary || '', body: p.body || '', image: p.image || '',
  type: p.type, type_label: TYPES[p.type] || p.type, movie_id: p.movie_id || null, cinema_id: p.cinema_id || null,
  starts_at: p.starts_at || null, ends_at: p.ends_at || null, pinned: !!p.pinned, created_at: p.created_at
});

// Bài mẫu khi chạy thử bằng bộ nhớ trong – nội dung khớp đúng bảng giá / loại vé mặc định
const SEED = [
  { id: 'thu-ba-vui-ve', type: 'PROMO', pinned: true, image: 'images/t3.webp', title: 'Thứ Ba vui vẻ – vé từ 40.000 đ',
    summary: 'Mọi suất chiếu thứ Ba hằng tuần: ghế thường 40.000 đ, ghế VIP 45.000 đ, ghế đôi 90.000 đ.',
    body: 'Áp dụng cho tất cả suất chiếu vào thứ Ba tại mọi rạp, đặt online hoặc tại quầy.\n\nGiá đã hiển thị sẵn khi bạn chọn suất và chọn ghế; không cần nhập mã.\n\nCó thể dùng kèm vé ưu đãi HSSV / U22, trẻ em, người cao tuổi.' },
  { id: 've-hssv-u22', type: 'PROMO', pinned: false, image: 'images/hssv.webp', title: 'Vé HSSV / U22 giảm 10.000 đ',
    summary: 'Chọn loại vé "HSSV / U22" ở bước chọn ghế, giảm 10.000 đ mỗi vé ghế thường hoặc VIP.',
    body: 'Dành cho học sinh, sinh viên hoặc khách dưới 22 tuổi.\n\nVui lòng mang thẻ học sinh, sinh viên hoặc CCCD để nhân viên kiểm tra khi soát vé. Không áp dụng cho ghế đôi Sweetbox.' },
  { id: 'suat-som-truoc-10h', type: 'PROMO', pinned: false, image: 'images/phimhayt10-1702x621-1-135337-300926-58.webp', title: 'Suất sớm trước 10:00 – vé từ 40.000 đ',
    summary: 'Các suất bắt đầu trước 10 giờ sáng có giá thấp hơn ngày thường và cuối tuần.',
    body: 'Áp dụng mọi ngày trong tuần cho các suất bắt đầu trước 10:00.\n\nXem các suất sớm ở trang Lịch chiếu theo rạp.' }
];

let seeded = false;
async function seedDemo() {
  if (seeded || Store.isLive()) return;
  seeded = true;
  if ((await Store.find('posts', {}, { limit: 1, order: null })).length) return;
  for (const p of SEED) await Store.insert('posts', { ...p, published: true, movie_id: null, cinema_id: null, starts_at: null, ends_at: null });
}

// Bài đang hiển thị cho khách: đã đăng và còn trong thời hạn; ghim lên đầu rồi mới nhất trước
async function list({ type, movie, cinema, limit = 30 } = {}) {
  await CatalogDB.seedDemo();
  await seedDemo();
  const now = new Date().toISOString();
  let rows = (await Store.find('posts', { published: true }, { order: 'created_at', asc: false, limit: 500 }))
    .filter(p => (!p.starts_at || p.starts_at <= now) && (!p.ends_at || p.ends_at >= now));
  if (type) rows = rows.filter(p => p.type === type);
  // Theo phim / rạp: bài gắn đúng phim/rạp đó + bài chung (không gắn phim/rạp nào)
  if (movie) rows = rows.filter(p => !p.movie_id || p.movie_id === movie);
  if (cinema) rows = rows.filter(p => !p.cinema_id || p.cinema_id === cinema);
  rows.sort((a, b) => (!!b.pinned - !!a.pinned) || (a.created_at < b.created_at ? 1 : -1));
  return rows.slice(0, limit).map(publicPost);
}

async function get(id) {
  await seedDemo();
  const p = await Store.one('posts', { id: str(id, 80) });
  const now = new Date().toISOString();
  if (!p || !p.published || (p.starts_at && p.starts_at > now) || (p.ends_at && p.ends_at < now)) return null;
  return publicPost(p);
}

async function adminList() {
  await seedDemo();
  return (await Store.find('posts', {}, { order: 'created_at', asc: false, limit: 500 })).map(p => ({ ...publicPost(p), published: !!p.published }));
}

async function save(b) {
  const title = str(b.title, 160);
  if (title.length < 4) throw httpError('Nhập tiêu đề bài viết', 400);
  if (!TYPES[b.type]) throw httpError('Chọn loại bài: ưu đãi, tin mới hoặc sự kiện', 400);
  const image = str(b.image, 500);
  if (image && !/^(images\/[\w./-]+|https:\/\/[^\s"'<>]+)$/i.test(image)) throw httpError('Ảnh phải là đường dẫn images/… hoặc link https://', 400);
  const date = (v) => (v ? new Date(v).toISOString() : null);
  const row = {
    title, type: b.type, summary: str(b.summary, 300), body: str(b.body, 8000), image: image || null,
    movie_id: str(b.movie_id, 80) || null, cinema_id: str(b.cinema_id, 80) || null,
    starts_at: date(b.starts_at), ends_at: date(b.ends_at),
    published: b.published === true || b.published === 'true', pinned: b.pinned === true || b.pinned === 'true'
  };
  if (row.starts_at && row.ends_at && row.starts_at > row.ends_at) throw httpError('Ngày kết thúc phải sau ngày bắt đầu', 400);
  const id = str(b.id, 80);
  if (id && await Store.one('posts', { id })) {
    const [u] = await Store.update('posts', { id }, row);
    return u;
  }
  let slug = CatalogDB.slug(title).slice(0, 70) || 'bai-viet';
  if (await Store.one('posts', { id: slug })) slug += '-' + Date.now().toString(36);
  return Store.insert('posts', { id: slug, ...row });
}

async function remove(id) {
  await Store.remove('posts', { id: str(id, 80) });
  return { ok: true };
}

module.exports = { TYPES, list, get, adminList, save, remove, publicPost, SEED };
