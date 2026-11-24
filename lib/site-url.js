// lib/site-url.js - Địa chỉ chính thức của web: link "Xem đơn hàng" trong email, link hủy nhận tin,
// địa chỉ IPN / trang quay về của cổng thanh toán, sitemap khi không có yêu cầu web đi kèm.
// Trên Vercel lấy tên miền production do Vercel tự cấp (VERCEL_PROJECT_PRODUCTION_URL: tên miền riêng ngắn nhất,
// nếu không có thì tên *.vercel.app) – luôn đúng kể cả khi đổi project hay gắn tên miền mới, nên biến SITE_URL
// cũ để sót không còn làm link trỏ sai. Chạy ngoài Vercel (máy cá nhân, máy chủ riêng) thì dùng SITE_URL.
function envSiteUrl(env = process.env) {
  const v = String(env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/+$/, '');
  if (v) return /^https?:\/\//i.test(v) ? v : 'https://' + v;
  return String(env.SITE_URL || '').trim().replace(/\/+$/, '');
}

module.exports = { envSiteUrl };
