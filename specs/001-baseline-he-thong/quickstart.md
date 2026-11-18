# Quickstart: chạy và kiểm tra baseline

1. `npm install`
2. Chạy kiểm thử luồng chính (bộ nhớ trong, không cần Supabase): `npm test` → phải báo 16/16 đạt.
3. Chạy máy chủ dev: `npm start` → mở `http://localhost:3000/home.html`.
4. Luồng khách: đăng ký → chọn phim/suất/ghế → checkout → trang VietQR → bảng sandbox (chỉ localhost)
   mô phỏng "chuyển đúng / muộn / thiếu / thừa".
5. Luồng nội bộ: `admin.html` → tạo Quản lý đầu tiên bằng `ADMIN_KEY` → tạo tài khoản Kế toán/CSKH/Quầy
   → thử hoàn tiền thủ công và soát vé QR.
6. Triển khai thật: làm theo `DEPLOY.md` (migrations, biến môi trường, kiểm tra sau deploy).
