// lib/routes/auth.js (phục vụ tại /api/auth) - Đăng ký / đăng nhập / hồ sơ thành viên Beta Club
//   POST ?action=register  { full_name, email, phone, password, birthday }
//   POST ?action=login     { login (email hoặc SĐT), password }   (sai 5 lần / 15 phút -> khóa 15 phút)
//   POST ?action=forgot    { email }                              gửi mã 6 số qua email
//   POST ?action=reset     { email, code, new_password }
//   GET  ?action=me        (Authorization: Bearer <token>)
//   POST ?action=profile   { full_name, phone, birthday }
//   POST ?action=password  { current_password, new_password }
//   GET  ?action=export                        tải toàn bộ dữ liệu cá nhân (JSON) – NĐ 13/2023
//   POST ?action=delete    { password, confirm: 'XOA' }   xóa tài khoản (đơn hàng được ẩn danh, không xóa)
//   GET  ?action=unsubscribe&u=<id>&t=<chữ ký>  hủy nhận email ưu đãi từ link trong thư (không cần đăng nhập)
const Auth = require('../auth');
const { fail, clean } = require('../api-util');

module.exports = async function handler(req, res) {
  const action = clean((req.query && req.query.action) || (req.body && req.body.action));
  const b = req.body || {};
  try {
    if (req.method === 'POST' && action === 'register') return res.status(200).json({ ok: true, ...(await Auth.register(b, require('../ratelimit').ipOf(req))) });
    if (req.method === 'POST' && action === 'login') return res.status(200).json({ ok: true, ...(await Auth.login(b, require('../ratelimit').ipOf(req))) });
    if (req.method === 'POST' && action === 'forgot') return res.status(200).json(await Auth.forgotPassword(b.email));
    if (req.method === 'POST' && action === 'reset') return res.status(200).json({ ok: true, ...(await Auth.resetPassword(b)) });
    if (req.method === 'GET' && action === 'unsubscribe') {
      await Auth.unsubscribe(clean(req.query.u), clean(req.query.t));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đã hủy nhận email</title><body style="font-family:system-ui;max-width:520px;margin:60px auto;padding:0 16px;text-align:center"><h1 style="color:#005198">Đã hủy nhận email ưu đãi</h1><p>Bạn sẽ không nhận email quảng cáo từ Beta Cinemas nữa. Email về vé, hoàn tiền vẫn được gửi bình thường. Bật lại trong Tài khoản → Thông tin cá nhân.</p><p><a href="/home.html">Về trang chủ</a></p></body>');
    }

    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Bạn chưa đăng nhập hoặc phiên đã hết hạn' });

    if (req.method === 'GET' && action === 'me') return res.status(200).json({ ok: true, user: Auth.publicCustomer(me) });
    if (req.method === 'POST' && action === 'profile') return res.status(200).json({ ok: true, user: await Auth.updateProfile(me, b) });
    if (req.method === 'POST' && action === 'password') return res.status(200).json({ ok: true, ...(await Auth.changePassword(me, b)) });
    if (req.method === 'GET' && action === 'export') {
      const data = await Auth.exportData(me);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="du-lieu-cua-toi_beta-cinemas.json"');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(JSON.stringify(data, null, 2));
    }
    if (req.method === 'POST' && action === 'delete') return res.status(200).json(await Auth.deleteAccount(me, b));
    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
