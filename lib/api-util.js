// lib/api-util.js - Tiện ích dùng chung cho các API handler
const Store = require('./store');

// Lỗi nghiệp vụ (e.http 4xx) trả nguyên thông báo; lỗi hệ thống (5xx) được ghi vào error_logs và
// có thể kích hoạt cảnh báo cho Quản lý (lib/ops.js). Không lộ chi tiết lỗi kỹ thuật cho khách.
async function fail(res, e) {
  const code = e.http || 500;
  if (code >= 500) {
    await require('./ops').error('api:' + (res.__route || '?'), e);
    return res.status(code).json({ ok: false, error: e.http ? e.message : 'Hệ thống đang bận, vui lòng thử lại sau ít phút' });
  }
  return res.status(code).json({ ok: false, error: e.message || 'Lỗi hệ thống', taken: e.taken });
}

// Khóa truy cập trang nội bộ (CSKH / Kế toán / IT). Đặt ADMIN_KEY trong biến môi trường.
// Chỉ khi chạy bộ nhớ trong (DB_MODE=mock / chưa có Supabase) mới cho phép khóa demo mặc định.
function adminKey() {
  return process.env.ADMIN_KEY || (Store.isLive() || Store.dbMissing() ? null : 'beta-admin');
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
