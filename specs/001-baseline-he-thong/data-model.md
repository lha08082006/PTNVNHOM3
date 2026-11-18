# Data Model: Baseline hệ thống Beta Cinemas

Nguồn chuẩn: `schema.sql` (+ `migrations/`). Mọi bảng bật RLS; chỉ máy chủ (service role) truy cập.

## Thực thể chính

| Bảng | Vai trò | Khóa / ràng buộc đáng chú ý |
|---|---|---|
| `customers` | Thành viên | email duy nhất, mật khẩu scrypt |
| `orders` | Đơn vé | `code` BC+10 số; `total >= 0`; `history` jsonb; mốc `hold_expires_at`, `scan_until` |
| `seat_holds` | Giữ/bán ghế | PK (suất, ghế) → 0 bán trùng; `HELD`/`SOLD` |
| `bank_transactions` | Giao dịch từ SePay | gắn `order_code` hoặc chưa khớp |
| `refunds` | Lệnh hoàn | `idempotency_key` unique; `amount > 0`; `deadline_at`; `review_log` |
| `support_tickets` | Phiếu CSKH | loại × trạng thái (xem dưới) |
| `notifications` | Thông báo | kênh WEB/EMAIL/SMS |
| `gateway_logs` | Log tra cứu/webhook | phục vụ tab IT |
| `staff`, `audit_logs` | Nhân viên, nhật ký | vai trò MANAGER/ACCOUNTANT/CS/COUNTER |
| `movies`, `cinemas`, `showtimes`, `vouchers` | Danh mục | voucher có giới hạn lượt |
| `ticket_checkins` | Soát vé | một lượt hợp lệ mỗi vé |
| `password_resets`, `auth_throttle` | OTP, chặn dò | khóa 15 phút sau 5 lần sai |

## Chuyển trạng thái đơn

```text
PENDING ──tiền đủ trong 10'──▶ CONFIRMED
PENDING ──hết 10'──▶ EXPIRED ──tiền về, còn ghế, ≥30' trước chiếu──▶ CONFIRMED_LATE
                     EXPIRED ──tiền về, hết ghế/gần giờ/thiếu──▶ REFUND_REQUESTED ──▶ REFUNDED
                     REFUND_REQUESTED ──quá 24h──▶ MANUAL_REVIEW
PENDING ──hủy/lỗi──▶ CANCELLED / FAILED
```

## Chuyển trạng thái lệnh hoàn

```text
REQUESTED ─▶ RETRYING ─▶ DONE
     └──quá hạn 24h──▶ MANUAL_REVIEW ─▶ FORM_SUBMITTED ─▶ CS_APPROVED ─▶ PAID_OUT
                                                  ▲            │
                                                  └─ ACC_RETURNED ◀┘ (Kế toán trả về)
```

Luật: người gửi `CS_APPROVED` không được thực hiện `PAID_OUT` cho cùng hồ sơ.

## Phiếu hỗ trợ

Loại: `PAYMENT_REPORT`, `MANUAL_REVIEW`, `DATA_MISMATCH`, `UNMATCHED_TX`, `GENERAL`.
Trạng thái: `OPEN` → `WAITING_CUSTOMER` | `WAITING_ACCOUNTING` → `RESOLVED`.
