// lib/banners.js - Banner trang chủ (Đợt 10): Quản lý đổi ảnh, đường dẫn, thứ tự, thời hạn ở admin.html > Danh mục > Banner
// Chưa có banner nào đang hiển thị -> trang chủ giữ 3 ảnh mặc định trong home.html.
const Store = require('./store');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

// Ảnh: link https (Supabase Storage, CDN) hoặc ảnh trong thư mục images/ của web
const IMG = /^(https:\/\/[^\s"'<>]+|\/?images\/[A-Za-z0-9._\/-]+)$/;
// Đường dẫn khi bấm banner: trang trong web (home.html, phim/suzume, tin-tuc.html?id=…, /rap) hoặc https://
const LINK = /^(https:\/\/[^\s"'<>]+|\/?[a-z0-9-]+(\.html)?(\/[a-z0-9-]+)?([?#][^\s"'<>]*)?)$/i;

const publicBanner = (b) => b && ({
  id: b.id, title: b.title, image: b.image, image_mobile: b.image_mobile || '', link: b.link || '',
  sort: Number(b.sort) || 0, starts_at: b.starts_at || null, ends_at: b.ends_at || null, active: b.active !== false
});
const order = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''));

// Banner đang hiển thị: bật, đã tới ngày bắt đầu, chưa hết hạn
async function list(now = new Date()) {
  const t = now.toISOString();
  const rows = await Store.find('banners', { active: true }, { order: null, limit: 50 });
  return rows.filter(b => (!b.starts_at || b.starts_at <= t) && (!b.ends_at || b.ends_at > t)).sort(order).slice(0, 10).map(publicBanner);
}
async function adminList() {
  return (await Store.find('banners', {}, { order: null, limit: 200 })).sort(order).map(publicBanner);
}

// Ngày dạng YYYY-MM-DD (ô chọn ngày ở admin) theo giờ Việt Nam: bắt đầu 00:00, kết thúc 23:59:59
function day(v, end) {
  const s = str(v, 40);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  const d = new Date(m ? m[1] + (end ? 'T23:59:59+07:00' : 'T00:00:00+07:00') : s);
  if (isNaN(d)) throw httpError('Ngày không hợp lệ: ' + s, 400);
  return d.toISOString();
}

async function save(b) {
  const title = str(b.title, 120);
  if (title.length < 2) throw httpError('Nhập tiêu đề banner (dùng làm chữ thay thế cho người khiếm thị)', 400);
  const image = str(b.image, 500);
  if (!IMG.test(image)) throw httpError('Ảnh banner phải là link https:// hoặc đường dẫn images/…', 400);
  const imageMobile = str(b.image_mobile, 500);
  if (imageMobile && !IMG.test(imageMobile)) throw httpError('Ảnh cho điện thoại phải là link https:// hoặc đường dẫn images/…', 400);
  const link = str(b.link, 500);
  if (link && !LINK.test(link)) throw httpError('Đường dẫn phải là trang trong web (vd phim/suzume, tin-tuc.html?id=…) hoặc link https://', 400);
  const sort = Math.max(0, Math.min(99, Math.round(Number(b.sort) || 0)));
  const starts = day(b.starts_at, false);
  const ends = day(b.ends_at, true);
  if (starts && ends && ends <= starts) throw httpError('Ngày kết thúc phải sau ngày bắt đầu', 400);
  const row = { title, image, image_mobile: imageMobile || null, link: link || null, sort, starts_at: starts, ends_at: ends, active: b.active !== false && b.active !== 'false' };
  const id = str(b.id, 60);
  if (id) {
    const [u] = await Store.update('banners', { id }, row);
    if (!u) throw httpError('Không tìm thấy banner', 404);
    return publicBanner(u);
  }
  if ((await Store.find('banners', {}, { limit: 60, order: null })).length >= 50) throw httpError('Tối đa 50 banner – xóa bớt banner cũ trước', 400);
  return publicBanner(await Store.insert('banners', row));
}

async function remove(id) {
  await Store.remove('banners', { id: str(id, 60) });
  return { ok: true };
}

module.exports = { list, adminList, save, remove, IMG, LINK };
