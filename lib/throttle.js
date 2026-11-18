// lib/throttle.js - Chặn dò mật khẩu / spam: đếm số lần sai theo khóa (tài khoản), khóa tạm khi vượt ngưỡng.
// Lưu trong DB (bảng auth_throttle) nên vẫn đúng khi chạy serverless nhiều tiến trình.
const Store = require('./store');

const WINDOW_MS = 15 * 60 * 1000;

const httpError = (msg, http) => Object.assign(new Error(msg), { http });

async function check(key, now = Date.now()) {
  const row = await Store.one('auth_throttle', { id: key });
  if (row && row.locked_until && new Date(row.locked_until).getTime() > now) {
    const mins = Math.ceil((new Date(row.locked_until).getTime() - now) / 60000);
    throw httpError(`Bạn thao tác sai quá nhiều lần. Vui lòng thử lại sau ${mins} phút.`, 429);
  }
}

// Ghi nhận một lần sai; đủ `max` lần trong 15 phút thì khóa 15 phút
async function fail(key, max = 5, now = Date.now()) {
  const row = await Store.one('auth_throttle', { id: key });
  const fresh = !row || !row.window_start || now - new Date(row.window_start).getTime() > WINDOW_MS;
  const fails = fresh ? 1 : (row.fails || 0) + 1;
  const patch = {
    fails, window_start: fresh ? new Date(now).toISOString() : row.window_start,
    locked_until: fails >= max ? new Date(now + WINDOW_MS).toISOString() : null
  };
  if (row) await Store.update('auth_throttle', { id: key }, patch);
  else {
    try { await Store.insert('auth_throttle', { id: key, ...patch }); }
    catch (e) { await Store.update('auth_throttle', { id: key }, patch); }
  }
  return fails;
}

async function reset(key) {
  await Store.remove('auth_throttle', { id: key });
}

module.exports = { check, fail, reset };
