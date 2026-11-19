# Data Model: Baseline thanh toán VietQR

Nguồn sự thật: `schema.sql`. Mock Store trong `lib/db.js` phải phản ánh cùng cấu trúc.

## orders

| Trường | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| id | uuid | PK |
| code | text | unique, `BC` + 10 số, = nội dung chuyển khoản |
| user_id | uuid? | FK auth.users |
| phone | text? | |
| movie_key, cinema, show_date, show_time | text | |
| showtime_key | text | `phim\|rạp\|ngày\|giờ` |
| seats | jsonb | `["D5","D6"]` |
| combos | jsonb | `{"solo":1}` |
| voucher | text? | |
| total | bigint ≥ 0 | tính ở server |
| paid_amount | bigint | cộng dồn |
| status | text | HOLDING, PARTIAL, PAID, EXPIRED, CANCELLED |
| hold_expires_at | timestamptz | created + 10 phút |
| paid_at, created_at | timestamptz | |

**Chuyển trạng thái**

```text
HOLDING ──đủ──▶ PAID
HOLDING ──thiếu──▶ PARTIAL ──bù đủ──▶ PAID
HOLDING|PARTIAL ──thừa──▶ PAID (+refund EXCESS)
*(quá hạn) ──nhận tiền──▶ EXPIRED (+refund LATE/SHORT 100%)
HOLDING ──hủy──▶ CANCELLED
```

## seat_holds

PK (`showtime_key`, `seat_id`); `order_id` FK cascade; `status` HELD | SOLD; `expires_at`.
Khi đơn PAID → SOLD; khi EXPIRED/CANCELLED → xóa dòng để nhả ghế.

## bank_transactions

`id` bigint PK (id SePay, chống trùng); `reference_code` (index); `code` (index); `amount`;
`content`; `transfer_type`; `raw` jsonb; `order_id` FK; `result` ∈ OK, SHORT, EXCESS, LATE,
DUPLICATE, RECOVERED, UNMATCHED, IGNORED, ERROR; `note`.

## refunds

`code` unique `REF-YYMM-NNN`; `order_id`; `bank_tx_id`; `amount > 0`;
`reason` ∈ LATE, SHORT, EXCESS, DUPLICATE, SYSTEM_ERROR;
`status` WAITING_INFO → RECEIVED → RECONCILING → APPROVED → DONE (trigger `touch_refund` ghi mốc);
`bank_name`, `acc_number`, `acc_name`, `refund_ref`. Unique (`bank_tx_id`, `reason`).

## complaints

`code` unique `CS-YYMM-NNN`; `bank_ref`; `order_code`; `phone`; `amount`; `description`;
`status` OPEN | RESOLVED.

## Lệch giữa code và schema (cần sửa)

- Webhook truyền `raw_payload`/`refund_id` nhưng `saveBankTransaction` chỉ đọc `raw`, nên `raw` lưu cả
  object đã trộn thay vì payload gốc; liên kết giao dịch ↔ hồ sơ hoàn chỉ có ở `refunds.bank_tx_id`
  mà hiện không được điền.
- Lỗi ghi Supabase bị nuốt và âm thầm rơi về Mock Store (mất dữ liệu ở production).
- `seat_holds` không bao giờ được chuyển SOLD hoặc nhả khi đơn hết hạn.
