// lib/schema-check.js - Đợt 10d: tự kiểm tra database thật đã chạy đủ migration chưa.
// Mỗi migration có vài "dấu hiệu" (bảng / cột nó tạo ra). Hỏi Supabase 0 dòng của từng dấu hiệu:
// lỗi "không tìm thấy bảng / cột" nghĩa là migration đó chưa chạy (hoặc PostgREST chưa nạp lại cấu trúc).
// Chỉ trả TÊN bảng / cột và mã lỗi – không đọc dữ liệu, không lộ khóa.
const Store = require('./store');

const MIGRATIONS = [
  ['schema.sql (bảng gốc)', [['orders', 'id'], ['seat_holds', 'showtime_key'], ['bank_transactions', 'id'], ['refunds', 'id']]],
  ['2026-11-18_quy-trinh-3-tang.sql', [['support_tickets', 'id'], ['notifications', 'id'], ['gateway_logs', 'id']]],
  ['2026-11-19_thanh-vien.sql', [['customers', 'id']]],
  ['2026-11-20_ke-toan-tra-ve.sql', [['staff', 'id'], ['audit_logs', 'id']]],
  ['2026-11-21_danh-muc-qr-otp.sql', [['movies', 'id'], ['cinemas', 'id'], ['showtimes', 'id'], ['vouchers', 'id'], ['ticket_checkins', 'id']]],
  ['2026-11-22_dot-1-gia-ve-tin-tuc.sql', [['ticket_types', 'id'], ['price_rules', 'id'], ['holidays', 'id'], ['posts', 'id']]],
  ['2026-11-24_dot-2-beta-club.sql', [['orders', 'kind,points_used'], ['point_ledger', 'id'], ['movie_reviews', 'id']]],
  ['2026-11-25_dot-3-phong-chieu-thue-rap.sql', [['rooms', 'id'], ['event_requests', 'id'], ['movie_watches', 'id'], ['showtimes', 'room_id']]],
  ['2026-11-26_dot-4-cong-thanh-toan-hoa-don.sql', [['payment_attempts', 'id'], ['invoice_requests', 'id']]],
  ['2026-11-27_dot-5-van-hanh-yeu-thich.sql', [['favorites', 'id'], ['error_logs', 'id'], ['system_state', 'id']]],
  ['2026-11-28_dot-6-du-lieu-ca-nhan-2fa-email.sql', [['customers', 'terms_version,marketing_opt_in,deleted_at'], ['staff', 'totp_enabled'], ['campaigns', 'id']]],
  ['2026-11-29_dot-7-ke-toan-cskh-quay.sql', [['support_tickets', 'assigned_to,internal_notes'], ['day_closings', 'id']]],
  ['2026-11-30_dot-9-trang-rap-xep-hang.sql', [['cinemas', 'phone,image,intro,amenities']]],
  ['2026-12-01_dot-10-banner-kho-anh.sql', [['banners', 'id']]],
];

const TTL = 60 * 1000;
let cache = null;

async function run() {
  if (!Store.isLive()) return { ok: true, mode: 'mock', missing: [] };
  const missing = [];
  let other = null;
  await Promise.all(MIGRATIONS.map(async ([file, probes]) => {
    const items = [];
    for (const [table, cols] of probes) {
      const r = await Store.probe(table, cols);
      if (r.ok) continue;
      if (r.kind === 'missing') items.push(cols === 'id' ? table : table + '(' + cols + ')');
      else if (!other) other = { table, code: r.code || null, message: r.message };
    }
    if (items.length) missing.push({ file, items });
  }));
  missing.sort((a, b) => (a.file < b.file ? -1 : 1));
  let bucket = null;
  try { bucket = await Store.bucketExists(process.env.MEDIA_BUCKET || 'media'); } catch (e) { bucket = null; }
  const out = { ok: !missing.length && !other, mode: 'live', missing, media_bucket: bucket, checked_at: new Date().toISOString() };
  if (other) out.other_error = other;
  if (missing.length) {
    out.hint = 'Database thiếu bảng / cột của ' + missing.length + ' migration. Mở Supabase (đúng dự án trong SUPABASE_URL) > SQL Editor, chạy lần lượt các file trên' +
      ' (hoặc file gộp migrations/GOP-dot-2-den-dot-10.sql). Nếu chắc chắn đã chạy thành công mà vẫn báo thiếu, chạy thêm: notify pgrst, \'reload schema\';';
  }
  return out;
}

// fresh=true bỏ qua bộ nhớ đệm (dùng sau khi vừa chạy migration)
async function check({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.value;
  const value = await run();
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { check, MIGRATIONS, _reset: () => { cache = null; } };
