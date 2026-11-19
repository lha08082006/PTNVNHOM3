// api/create-order.js - Tạo đơn hàng: tổng tiền tính ở server, giữ ghế 10 phút
const DB = require('../lib/db');
const { quote, PricingError } = require('../lib/pricing');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    if (!body.movie_key || !body.cinema || !body.show_date || !body.show_time) {
      return res.status(400).json({ error: 'Thiếu thông tin phim / rạp / suất chiếu' });
    }

    // Không tin tổng tiền do trình duyệt gửi: tính lại từ bảng giá server
    const priced = quote({ seats: body.seats, combos: body.combos, voucher: body.voucher });
    if (priced.total <= 0) {
      return res.status(400).json({ error: 'Số tiền đơn hàng không hợp lệ' });
    }
    const clientTotal = Number(body.total);
    if (Number.isFinite(clientTotal) && clientTotal !== priced.total) {
      console.warn(`[API create-order] Tổng tiền client (${clientTotal}) khác server (${priced.total}), dùng giá server.`);
    }

    const order = await DB.createOrder({
      user_id: body.user_id || null,
      phone: body.phone ? String(body.phone).trim() : null,
      movie_key: String(body.movie_key),
      cinema: String(body.cinema),
      show_date: String(body.show_date),
      show_time: String(body.show_time),
      seats: priced.seats,
      combos: priced.combos,
      voucher: priced.voucher,
      total: priced.total
    });

    return res.status(200).json({
      ok: true,
      id: order.id,
      code: order.code,
      total: order.total,
      seats: order.seats,
      discount: priced.discount,
      hold_expires_at: order.hold_expires_at
    });
  } catch (error) {
    if (error instanceof PricingError) {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'SEAT_TAKEN') {
      return res.status(409).json({ error: error.message });
    }
    console.error('[API create-order Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi tạo đơn hàng' });
  }
};
