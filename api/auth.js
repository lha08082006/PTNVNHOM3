// api/auth.js - Đăng ký / đăng nhập / hồ sơ thành viên Beta Club
//   POST ?action=register  { full_name, email, phone, password, birthday }
//   POST ?action=login     { login (email hoặc SĐT), password }   (sai 5 lần / 15 phút -> khóa 15 phút)
//   POST ?action=forgot    { email }                              gửi mã 6 số qua email
//   POST ?action=reset     { email, code, new_password }
//   GET  ?action=me        (Authorization: Bearer <token>)
//   POST ?action=profile   { full_name, phone, birthday }
//   POST ?action=password  { current_password, new_password }
const Auth = require('../lib/auth');
const { fail, clean } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  const action = clean((req.query && req.query.action) || (req.body && req.body.action));
  const b = req.body || {};
  try {
    if (req.method === 'POST' && action === 'register') return res.status(200).json({ ok: true, ...(await Auth.register(b)) });
    if (req.method === 'POST' && action === 'login') return res.status(200).json({ ok: true, ...(await Auth.login(b)) });
    if (req.method === 'POST' && action === 'forgot') return res.status(200).json(await Auth.forgotPassword(b.email));
    if (req.method === 'POST' && action === 'reset') return res.status(200).json({ ok: true, ...(await Auth.resetPassword(b)) });

    const me = await Auth.currentCustomer(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Bạn chưa đăng nhập hoặc phiên đã hết hạn' });

    if (req.method === 'GET' && action === 'me') return res.status(200).json({ ok: true, user: Auth.publicCustomer(me) });
    if (req.method === 'POST' && action === 'profile') return res.status(200).json({ ok: true, user: await Auth.updateProfile(me, b) });
    if (req.method === 'POST' && action === 'password') return res.status(200).json({ ok: true, ...(await Auth.changePassword(me, b)) });
    return res.status(400).json({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (e) {
    return fail(res, e);
  }
};
