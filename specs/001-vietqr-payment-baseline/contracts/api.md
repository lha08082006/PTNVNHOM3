# API Contracts

Tất cả trả JSON UTF-8. Lỗi: `{ "error": "<thông báo tiếng Việt>" }`.

| Method | Path | Body / Query | 200 Response | Lỗi |
|---|---|---|---|---|
| POST | `/api/create-order` | `{movie_key, cinema, show_date, show_time, seats[], combos{}, voucher?, total, phone?}` | `{ok, id, code, total, hold_expires_at}` | 400 tổng tiền/ghế không hợp lệ; 409 ghế đã giữ |
| GET | `/api/order-status?code=` | — | `{ok, id, code, status, total, paid_amount, remaining_amount, excess_amount, hold_expires_at, paid_at, movie_key, cinema, show_date, show_time, seats, combos, refund}` | 400 thiếu code; 404 |
| GET | `/api/orders?limit=&phone=` | limit ≤ 50 | `{ok, orders[]}` | |
| POST | `/api/sepay-webhook` | Header `Authorization: Apikey <key>`; payload SePay `{id, gateway, transactionDate, accountNumber, code, content, transferType, transferAmount, referenceCode, ...}` | `{success, code, result, paid_amount, total, refund}` hoặc `{success, result:"UNMATCHED"\|"IGNORED"}` hoặc `{success, message:"đã ghi nhận trước đó"}` | 401 sai key |
| POST | `/api/reconcile` | `{order_code?, bank_ref?, phone?, amount?}` (≥ 1 mã) | `{ok:true, status:"RECOVERED_PAID", ticket_url}` \| `{ok:true, status:"RECOVERED_REFUND", refund_code, refund_url}` \| `{ok:false, status:"COMPLAINT_CREATED", complaint_code}` | 400 thiếu mã; 404 |
| GET | `/api/refund?code=\|order_code=` | — | `{ok, refund, order}` | 404 |
| POST | `/api/refund` | `{code? \| order_code?, bank_name, acc_number, acc_name}` | `{ok, refund_code, status:"RECEIVED", amount, bank_name, acc_number, acc_name, message}` | 400 thiếu trường; 404 |
| POST | `/api/simulate-payment` | `{scenario: OK\|SHORT\|EXCESS\|LATE\|NETWORK_LAG, order_code?, custom_amount?}` | `{ok, scenario, description, webhook_response, reference_code}` | 404 khi tắt simulator |
