// lib/api-util.js - Tiện ích dùng chung cho các API handler
const Store = require('./store');

function fail(res, e) {
  if (!e.http) console.error('[API Error]', e);
  return res.status(e.http || 500).json({ ok: false, error: e.message || 'Lỗi hệ thống', taken: e.taken });
}

// Khóa truy cập trang nội bộ (CSKH / Kế toán / IT). Đặt ADMIN_KEY trong biến môi trường.
// Chỉ khi chạy bộ nhớ trong (DB_MODE=mock / chưa có Supabase) mới cho phép khóa demo mặc định.
function adminKey() {
  return process.env.ADMIN_KEY || (Store.isLive() ? null : 'beta-admin');
}

function requireAdmin(req, res) {
  const expected = adminKey();
  const got = String((req.headers && req.headers['x-admin-key']) || '');
  if (!expected) { res.status(503).json({ ok: false, error: 'Chưa cấu hình ADMIN_KEY trên máy chủ' }); return false; }
  if (got !== expected) { res.status(401).json({ ok: false, error: 'Sai khóa truy cập nội bộ' }); return false; }
  return true;
}

const clean = (s) => String(s == null ? '' : s).trim();
const orderCodeOf = (req) => clean(
  (req.query && (req.query.code || req.query.order || req.query.order_code)) ||
  (req.body && (req.body.order_code || req.body.code || req.body.order))
).toUpperCase();

module.exports = { fail, requireAdmin, clean, orderCodeOf, adminKey };
