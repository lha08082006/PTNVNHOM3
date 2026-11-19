# API Contracts

Tất cả trả JSON UTF-8. Lỗi: `{ "error": "<thông báo tiếng Việt>" }`.

| Method | Path | Body / Query | 200 Response | Lỗi |
|---|---|---|---|---|
| POST | `/api/create-order` | `{movie_key, cinema, show_date, show_time, seats[], combos{}, voucher?, total, phone?}` | `{ok, id, code, total, hold_expires_at}` | 400 tổng tiền/ghế không hợp lệ; 409 ghế đã giữ |
| GET | `/api/order-status?code=` | — | `{ok, id, code, status, total, paid_amount, remaining_amount, excess_amount, hold_expires_at, paid_at, movie_key, cinema, show_date, show_time, seats, combos, refund}` | 400 thiếu code; 404 |
| GET | `/api/orders?phone=&limit=` | `phone` bắt buộc; 1 ≤ limit ≤ 50 | `{ok, orders[]}` | 400 thiếu/sai phone |
| POST | `/api/sepay-webhook` | Header `Authorization: Apikey <key>`; payload SePay `{id, gateway, transactionDate, accountNumber, code, content, transferType, transferAmount, referenceCode, ...}` | `{success, code, result, status, paid_amount, total, remaining_amount, refund}`; `result` ∈ OK, SHORT, EXCESS, LATE, DUPLICATE, UNMATCHED, IGNORED; gửi lặp: `{success, duplicate:true}` | 400 thiếu id; 401 sai key; 503 chưa cấu hình key (production) |
| POST | `/api/reconcile` | `{order_code?, bank_ref?, phone?, amount?}` (≥ 1 mã) | `{ok:true, status:"RECOVERED_PAID", ticket_url}` \| `{ok:true, status:"RECOVERED_REFUND", refund_code, refund_url}` \| `{ok:false, status:"COMPLAINT_CREATED", complaint_code}` | 400 thiếu mã; 404; 409 mã GD thuộc đơn khác. Thêm `{ok:true, status:"PARTIAL", remaining_amount, underpay_url}` |
| GET | `/api/refund?code=\|order_code=` | — | `{ok, refund, order}` | 404 |
| POST | `/api/refund` | `{code? \| order_code?, bank_name, acc_number, acc_name}` | `{ok, refund_code, status:"RECEIVED", amount, bank_name, acc_number, acc_name, message}` | 400 thiếu trường / STK sai; 404; 409 hồ sơ đang xử lý. `acc_number` trả về luôn bị che |
| POST | `/api/simulate-payment` | `{scenario: OK\|SHORT\|EXCESS\|LATE\|NETWORK_LAG, order_code?, custom_amount?}` | `{ok, scenario, description, webhook_response, reference_code}` | 404 khi tắt simulator |
