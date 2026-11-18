# Triển khai Beta Cinemas lên Vercel + Supabase

## 1. Cơ sở dữ liệu (Supabase → SQL Editor)

- **DB mới:** chạy toàn bộ `schema.sql`.
- **DB đang chạy:** chạy lần lượt (mỗi file chạy lại được, an toàn):
  1. `migrations/2026-11-18_quy-trinh-3-tang.sql`
  2. `migrations/2026-11-19_thanh-vien.sql` — bảng `customers`, `orders.user_id`, loại phiếu `GENERAL`
  3. `migrations/2026-11-20_ke-toan-tra-ve.sql` — trạng thái `ACC_RETURNED` (Kế toán trả hồ sơ về nhân viên)

## 2. Biến môi trường (Vercel → Settings → Environment Variables)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | ✔ | Khóa service role, chỉ dùng phía máy chủ |
| `AUTH_SECRET` | ✔ | Chuỗi ngẫu nhiên ≥ 32 ký tự. Đổi giá trị này = đăng xuất mọi thành viên |
| `ADMIN_KEY` | ✔ | Khóa đăng nhập `admin.html` |
| `SEPAY_WEBHOOK_KEY` | ✔ | Đặt trùng với API Key trong cấu hình webhook SePay. Thiếu → webhook bị từ chối (503) |
| `SEPAY_API_KEY` | ✔ | Khóa API SePay **mới** (khóa cũ đã lộ trong lịch sử git, phải thu hồi) |
| `CRON_SECRET` | nên có | Bảo vệ `/api/cron` |
| `RESEND_API_KEY`, `MAIL_FROM` | tùy chọn | Gửi email vé/hoàn tiền thật. Trống → chỉ ghi nhận, không gửi |
| `SITE_URL` | tùy chọn | Dùng cho link "Xem đơn hàng" trong email |
| `ALLOW_SANDBOX` | **không** đặt trên production | `1` = mở `/api/simulate-payment` (vẫn cần `x-admin-key`) cho UAT |

## 3. Kiểm tra trước khi deploy

```bash
npm test
```

Chạy toàn bộ luồng chính ở chế độ bộ nhớ trong: đăng ký/đăng nhập, tính giá phía máy chủ, chống trùng ghế,
quyền xem đơn, thanh toán sandbox, phiếu hỗ trợ, đổi mật khẩu, khóa webhook.

## 4. Sau khi deploy

- Đăng ký 1 tài khoản thật → đặt vé giá nhỏ → chuyển khoản VietQR → vé phải tự xuất trong vài giây.
- Mở `admin.html` bằng `ADMIN_KEY`, kiểm tra đơn và nhật ký webhook.
- Gửi thử form ở `support.html` → phiếu "Yêu cầu hỗ trợ" phải hiện trong admin.

## Ghi chú

- Giá vé, combo, voucher, danh sách phim nằm ở `catalog.js` (dùng chung cho trình duyệt và máy chủ). Sửa giá = sửa file này rồi deploy.
- Thanh điều hướng thiết kế (⚡ quick-dock) và bảng sandbox trên trang VietQR chỉ hiện ở `localhost` (hoặc thêm `?dev=1` / `?sandbox=1`).
