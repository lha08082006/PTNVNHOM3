# API Contract (baseline)

Tất cả trả JSON `{ ok: boolean, error?: string, ... }`. Lỗi nghiệp vụ dùng mã HTTP 400/401/403/409/429/503.

| Endpoint | Phương thức | Xác thực | Mục đích |
|---|---|---|---|
| `/api/auth?action=register\|login\|forgot\|reset` | POST | — (throttle) | Tài khoản khách, OTP |
| `/api/auth?action=me\|profile\|password` | GET/POST | token khách | Hồ sơ, đổi mật khẩu |
| `/api/catalog?action=movies\|cinemas\|showtimes\|showtime\|voucher` | GET | — | Danh mục công khai |
| `/api/seats` | GET | — | Ghế đã giữ/bán của suất |
| `/api/create-order` | POST | token khách | Tạo đơn, giữ ghế, trả VietQR (giá tính phía máy chủ) |
| `/api/order-status` | GET | chủ đơn | Trạng thái + chạy `Flow.tick` |
| `/api/orders` | GET | token khách | Lịch sử đơn của chính khách |
| `/api/refund` | GET/POST | chủ đơn | Theo dõi hoàn, gửi RefundForm |
| `/api/report-issue` | POST | chủ đơn | "Đã chuyển tiền nhưng chưa có vé" |
| `/api/support` | POST | tùy chọn | Phiếu hỗ trợ GENERAL |
| `/api/sepay-webhook` | POST | `SEPAY_WEBHOOK_KEY` | Giao dịch đến |
| `/api/reconcile` | POST | khóa quản trị | Đối soát thủ công |
| `/api/cron` | GET | `CRON_SECRET` | Chạy `Flow.runJob` |
| `/api/simulate-payment` | POST | `ALLOW_SANDBOX=1` + `x-admin-key` | Sandbox UAT |
| `/api/admin?action=…` | GET/POST | token nhân viên + quyền vai trò | Xem bảng dưới |

## `/api/admin` actions

- Công khai: `status`, `login`, `bootstrap` (một lần, cần `ADMIN_KEY`).
- Mọi vai trò: `me`, `change_password`.
- Vận hành: `dashboard`, `overview`, `order`, `report`, `checkin`, `run_job`, `resolve_ticket`, `remind`.
- Hoàn tiền: `send_to_accounting` (CSKH), `decide`, `accounting_reject` / `accounting_paid` (Kế toán), `confirm_done`.
- Danh mục (Quản lý): `catalog`, `showtime_list`, `movie_save`, `cinema_save`, `showtime_create`, `showtime_update`, `voucher_save`.
- Nhân sự (Quản lý): `staff_list`, `staff_create`, `staff_update`, `audit`.

Mọi POST thành công trong `/api/admin` (trừ `change_password` ghi riêng) được ghi `audit_logs`.
