// api/orders.js - Danh sách đơn hàng cho trang Lịch Sử Đặt Vé (lọc theo số điện thoại chủ đơn)
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const phone = String(req.query.phone || '').trim();
    if (!/^0\d{9,10}$/.test(phone)) {
      return res.status(400).json({ error: 'Vui lòng cung cấp số điện thoại hợp lệ (phone) để xem lịch sử đơn' });
    }
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20;

    const orders = await DB.getOrders({ limit, phone });
    return res.status(200).json({ ok: true, orders: orders || [] });
  } catch (error) {
    console.error('[API orders Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi lấy danh sách đơn hàng' });
  }
};
