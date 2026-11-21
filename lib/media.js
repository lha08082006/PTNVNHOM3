// lib/media.js - Tải ảnh lên từ admin (Đợt 10): poster phim, banner, ảnh rạp, ảnh bài viết
// - Trình duyệt tự thu nhỏ ảnh (canvas) trước khi gửi, máy chủ chỉ nhận JPG / PNG / WebP ≤ 2,5 MB
//   và kiểm tra "chữ ký" đầu tệp (không tin tên tệp hay loại tệp trình duyệt khai báo).
// - Web thật: lưu vào Supabase Storage, kho công khai "media" (tạo bằng migration 2026-12-01) -> trả link https.
// - Chạy thử ở máy (bộ nhớ trong): ghi vào images/uploads/ (đã bỏ qua trong git) -> trả đường dẫn images/uploads/…
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Store = require('./store');

const BUCKET = process.env.MEDIA_BUCKET || 'media';
const KINDS = ['poster', 'banner', 'cinema', 'post'];
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = Math.round(2.5 * 1024 * 1024);
const httpError = (msg, http) => Object.assign(new Error(msg), { http });

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function upload({ kind, data } = {}) {
  if (!KINDS.includes(kind)) throw httpError('Loại ảnh không hợp lệ', 400);
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(data || ''));
  if (!m) throw httpError('Không đọc được ảnh gửi lên', 400);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw httpError('Ảnh rỗng', 400);
  if (buf.length > MAX_BYTES) throw httpError('Ảnh quá lớn (tối đa 2,5 MB sau khi thu nhỏ). Thử ảnh khác hoặc cắt bớt.', 413);
  const type = sniff(buf);
  if (!type || !TYPES[type]) throw httpError('Chỉ nhận ảnh JPG, PNG hoặc WebP', 400);
  const now = new Date();
  const rel = kind + '/' + now.getUTCFullYear() + String(now.getUTCMonth() + 1).padStart(2, '0') + '/' + crypto.randomBytes(8).toString('hex') + '.' + TYPES[type];

  const st = Store.storage();
  if (!st) {
    if (Store.dbMissing()) throw httpError('Web chưa nối database nên chưa tải ảnh được', 503);
    const dir = path.join(__dirname, '..', 'images', 'uploads', path.dirname(rel));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'images', 'uploads', rel), buf);
    return { url: 'images/uploads/' + rel, bytes: buf.length, type, local: true };
  }
  const { error } = await st.from(BUCKET).upload(rel, buf, { contentType: type, cacheControl: '31536000', upsert: false });
  if (error) throw httpError('Kho ảnh báo lỗi: ' + error.message + '. Kiểm tra đã chạy migration 2026-12-01 (tạo kho "media") chưa.', 502);
  const { data: pub } = st.from(BUCKET).getPublicUrl(rel);
  return { url: pub.publicUrl, bytes: buf.length, type };
}

module.exports = { upload, sniff, KINDS, MAX_BYTES };
