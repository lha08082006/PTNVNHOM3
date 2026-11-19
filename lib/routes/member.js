// lib/routes/member.js (phục vụ tại /api/member) - Beta Club & đánh giá phim (Đợt 2)
//   GET  ?action=points                         điểm, hạng, lịch sử điểm của thành viên đăng nhập
//   GET  ?action=reviews&movie=<id>             đánh giá công khai của phim (không cần đăng nhập)
//   GET  ?action=review_stats                   điểm trung bình mọi phim
//   GET  ?action=can_review&movie=<id>          các đơn đã soát vé, chưa đánh giá (đăng nhập)
//   POST ?action=review { order_code, rating, content }
const Auth = require('../auth');
const Points = require('../points');
const Reviews = require('../reviews');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const action = clean(q.action);
  try {
    if (req.method === 'GET' && action === 'reviews') {
      return res.status(200).json({ ok: true, ...(await Reviews.list(clean(q.movie), { limit: Number(q.limit) || 20 })) });
    }
    if (req.method === 'GET' && action === 'review_stats') return res.status(200).json({ ok: true, stats: await Reviews.stats() });

    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập' });
    if (req.method === 'GET' && action === 'points') return res.status(200).json({ ok: true, ...(await Points.overview(me)) });
    if (req.method === 'GET' && action === 'can_review') return res.status(200).json({ ok: true, orders: await Reviews.eligible(me, clean(q.movie)) });
    if (req.method === 'POST' && action === 'review') return res.status(200).json({ ok: true, review: await Reviews.create(me, req.body || {}) });
    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
