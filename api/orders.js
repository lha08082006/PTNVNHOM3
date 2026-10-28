// api/orders.js - Trả về danh sách đơn hàng cho giao diện Lịch Sử Đặt Vé & Supabase
const DB = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const limit = Math.min(50, Number(req.query.limit || 20));
    const phone = req.query.phone || null;
    const orders = await DB.getOrders({ limit, phone });

    return res.status(200).json({
      ok: true,
      orders: orders || []
    });
  } catch (error) {
    console.error('[API orders Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi lấy danh sách đơn hàng' });
  }
};
