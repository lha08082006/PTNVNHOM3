/**
 * js/accounts.js - Kho tài khoản (bản demo lưu trên trình duyệt)
 *
 * Mật khẩu chỉ lưu dạng băm SHA-256. Khi có database, thay các hàm dưới đây bằng
 * Supabase Auth / API; các trang (auth.html, account.html) giữ nguyên.
 */
(function () {
  const KEY = 'BETA_ACCOUNTS';
  const DEMO = {
    name: 'LƯƠNG HỒNG ANH', phone: '0987654321', email: 'luonghonganh@betacinemas.vn', dob: '2006-08-08',
    // sha256("12345678")
    passHash: 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f'
  };

  function load() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
    if (!list.some(a => a.email === DEMO.email)) list.unshift(Object.assign({}, DEMO));
    return list;
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Tìm theo email hoặc số điện thoại
  function find(id) {
    id = String(id || '').trim().toLowerCase();
    return load().find(a => a.email.toLowerCase() === id || a.phone === id) || null;
  }

  async function verify(id, password) {
    const acc = find(id);
    return acc && acc.passHash === await sha256(password) ? acc : null;
  }

  // Trả về chuỗi lỗi, hoặc '' nếu hợp lệ
  function validatePassword(p) {
    return String(p || '').length < 8 ? 'Mật khẩu phải có ít nhất 8 ký tự.' : '';
  }

  async function register(data) {
    const list = load();
    if (list.some(a => a.email === data.email)) throw new Error('Email này đã được đăng ký.');
    if (list.some(a => a.phone === data.phone)) throw new Error('Số điện thoại này đã được đăng ký.');
    const acc = { name: data.name, phone: data.phone, email: data.email, dob: data.dob, passHash: await sha256(data.password) };
    list.push(acc);
    save(list);
    return acc;
  }

  async function setPassword(email, newPassword) {
    const list = load();
    const acc = list.find(a => a.email === email);
    if (!acc) throw new Error('Không tìm thấy tài khoản.');
    acc.passHash = await sha256(newPassword);
    save(list);
  }

  function update(email, fields) {
    const list = load();
    const acc = list.find(a => a.email === email);
    if (!acc) return;
    Object.assign(acc, fields);
    save(list);
  }

  // ---- Quên mật khẩu: mã OTP 6 số, hiệu lực 5 phút (demo: hiển thị mã trên màn hình) ----
  const OTP_KEY = 'BETA_RESET_OTP';

  function requestReset(id) {
    const acc = find(id);
    if (!acc) throw new Error('Không tìm thấy tài khoản với email / số điện thoại này.');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    try { sessionStorage.setItem(OTP_KEY, JSON.stringify({ email: acc.email, otp, exp: Date.now() + 5 * 60000 })); } catch (e) {}
    return { email: acc.email, phone: acc.phone, otp };
  }

  async function confirmReset(otp, newPassword) {
    let req = null;
    try { req = JSON.parse(sessionStorage.getItem(OTP_KEY) || 'null'); } catch (e) {}
    if (!req) throw new Error('Vui lòng yêu cầu mã OTP trước.');
    if (Date.now() > req.exp) throw new Error('Mã OTP đã hết hạn, vui lòng gửi lại.');
    if (String(otp).trim() !== req.otp) throw new Error('Mã OTP không đúng.');
    const err = validatePassword(newPassword);
    if (err) throw new Error(err);
    await setPassword(req.email, newPassword);
    try { sessionStorage.removeItem(OTP_KEY); } catch (e) {}
    return find(req.email);
  }

  window.Accounts = { DEMO, load, find, verify, register, setPassword, update, validatePassword, requestReset, confirmReset, sha256 };
})();
