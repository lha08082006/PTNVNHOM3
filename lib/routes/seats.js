// lib/routes/seats.js (phục vụ tại /api/seats) - Ghế đang được giữ / đã bán của một suất chiếu (chống bán trùng ghế, NFR-05)
const Flow = require('../flow');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const key = clean(req.query.showtime_key);
    if (!key) return res.status(400).json({ error: 'Thiếu showtime_key' });
    return res.status(200).json({ ok: true, seats: await Flow.takenSeats(key) });
  } catch (e) {
    return fail(res, e);
  }
};
