# Research: Baseline thanh toán VietQR

## R1. Quản lý bí mật

- **Decision**: Xóa khóa Supabase base64 hard-code trong `lib/db.js` và SePay API key thật trong
  `.env.example`; thiếu biến môi trường thì dùng Mock Store (dev) hoặc báo lỗi (production).
  Xoay (rotate) cả hai khóa vì chúng đã nằm trong lịch sử git.
- **Rationale**: Constitution II; khóa base64 vẫn là khóa lộ. Gỡ khỏi HEAD không xóa khỏi lịch sử,
  nên bắt buộc phải xoay khóa.
- **Alternatives**: viết lại lịch sử git (rủi ro cho cả nhóm, vẫn phải xoay khóa) — loại.

## R2. Xác thực webhook SePay

- **Decision**: SePay gửi header `Authorization: Apikey <SEPAY_API_KEY>`; webhook so sánh với biến
  môi trường bằng so sánh thời gian hằng (`crypto.timingSafeEqual`); sai → 401. Simulator gọi
  handler nội bộ với header hợp lệ.
- **Rationale**: chặn giả mạo thông báo tiền vào (FR-007).
- **Alternatives**: whitelist IP SePay — khó trên Vercel, loại.

## R3. Ghép giao dịch với đơn

- **Decision**: chỉ ghép khi nội dung chứa `BC\d{10}` (hoặc `DH\d+` cho test SePay) và đơn tồn tại;
  ngược lại lưu `UNMATCHED`. Bỏ hẳn fallback "đơn chờ gần nhất" và tự tạo đơn giả. Bỏ qua
  `transferType = out` với kết quả `IGNORED`. Thiếu `referenceCode` → dùng `id` của SePay, không
  sinh mã ngẫu nhiên (vì sẽ phá idempotency).
- **Rationale**: Constitution I, FR-004/005/006.

## R4. Simulator ở production

- **Decision**: `/api/simulate-payment` trả 404 trừ khi `ENABLE_SIMULATOR=true` (mặc định bật khi
  `NODE_ENV !== 'production'`).

## R5. Tính giá và khóa ghế

- **Decision**: `lib/pricing.js` giữ bảng giá ghế (thường/VIP/đôi), combo, voucher đang dùng ở
  `seats.html`/`combo.html`/`checkout.html`; `create-order` tính lại `total`, nếu lệch với client
  thì dùng giá server. Insert `seat_holds` kiểm tra `error`; vi phạm khóa chính → xóa đơn và trả
  409 "Ghế đã có người giữ". Mock Store mô phỏng tương tự bằng Map key `showtime|seat`.
- **Rationale**: FR-002, FR-016.

## R6. Kiểm thử

- **Decision**: `node --test tests/` với Mock Store (không đặt `SUPABASE_URL`), gọi trực tiếp handler
  bằng req/res giả (giống `simulate-payment.js`). Không thêm phụ thuộc.
- **Alternatives**: Jest/Vitest — thêm phụ thuộc không cần thiết (Constitution V).
