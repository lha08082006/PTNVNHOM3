---
description: "Task list: đưa hệ thống thanh toán VietQR hiện có về đúng Constitution v1.0.0"
---

# Tasks: Hệ thống đặt vé & thanh toán VietQR (Baseline toàn dự án)

**Input**: Design documents from `/specs/001-vietqr-payment-baseline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

**Tests**: BẮT BUỘC theo Constitution IV (kiểm thử tình huống thanh toán).

**Organization**: theo user story trong spec.md. Code baseline đã có sẵn phần lớn hành vi; các
task dưới đây là phần còn thiếu hoặc sai so với spec/constitution.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc)
- **[Story]**: US1…US7 theo spec.md

---

## Phase 1: Setup

- [ ] T001 Thêm script `"test": "node --test tests/"` và `"engines": {"node": ">=18"}` vào `package.json`
- [ ] T002 [P] Tạo `tests/helpers.js`: req/res giả (theo mẫu `api/simulate-payment.js`), hàm reset Mock Store, đảm bảo không đặt `SUPABASE_URL` khi test
- [ ] T003 [P] Thêm `DB.__resetMock()` (chỉ export khi `NODE_ENV === 'test'`) vào `lib/db.js`

---

## Phase 2: Foundational — Bảo mật (chặn mọi story) ⚠️

- [ ] T004 Xóa khóa Supabase URL/secret base64 hard-code ở đầu `lib/db.js`; chỉ đọc từ `process.env`
- [ ] T005 [P] Thay `SEPAY_API_KEY` và số tài khoản thật trong `.env.example` bằng giá trị placeholder
- [ ] T006 Xoay (rotate) Supabase secret key và SePay API key trên dashboard (việc thủ công của nhóm — khóa cũ đã nằm trong lịch sử git)
- [ ] T007 Ở production (`NODE_ENV=production`), `lib/db.js` MUST ném lỗi thay vì âm thầm rơi về Mock Store khi Supabase ghi lỗi
- [ ] T008 Chặn `/api/simulate-payment` bằng cờ `ENABLE_SIMULATOR` (mặc định tắt ở production) trong `api/simulate-payment.js`; thêm biến vào `.env.example`

**Checkpoint**: repo không còn bí mật; production không mất dữ liệu âm thầm.

---

## Phase 3: User Story 1 — Thanh toán đủ (P1) 🎯 MVP

### Tests

- [ ] T009 [P] [US1] `tests/webhook.test.js`: tình huống OK → đơn PAID, có `paid_at`, giao dịch `result=OK`
- [ ] T010 [P] [US1] `tests/webhook.test.js`: gửi lại cùng `referenceCode` → không cộng tiền lần 2
- [ ] T011 [P] [US1] `tests/webhook.test.js`: thiếu/sai header `Authorization` → 401, không ghi sổ cái
- [ ] T012 [P] [US1] `tests/webhook.test.js`: nội dung không có mã đơn → `UNMATCHED`, không đơn nào đổi trạng thái
- [ ] T013 [P] [US1] `tests/webhook.test.js`: mã đơn không tồn tại → `UNMATCHED`, không tự tạo đơn
- [ ] T014 [P] [US1] `tests/webhook.test.js`: `transferType=out` → `IGNORED`
- [ ] T015 [P] [US1] `tests/create-order.test.js`: `total` client sai → server dùng giá tính lại

### Implementation

- [ ] T016 [US1] Xác thực `Authorization: Apikey <SEPAY_API_KEY>` bằng `crypto.timingSafeEqual` trong `api/sepay-webhook.js`; simulator truyền header hợp lệ
- [ ] T017 [US1] Bỏ fallback "ghép vào đơn đang chờ gần nhất" trong `api/sepay-webhook.js`
- [ ] T018 [US1] Bỏ tự tạo đơn dự phòng với dữ liệu mẫu khi mã đơn không tồn tại → lưu `UNMATCHED`
- [ ] T019 [US1] Bỏ qua giao dịch `transferType=out` (`IGNORED`); dùng `id` SePay khi thiếu `referenceCode` thay vì `'FT'+Date.now()`
- [ ] T020 [US1] Kiểm tra idempotency theo cả `id` SePay lẫn `reference_code` trong `DB.findBankTransaction`
- [ ] T021 [US1] Lưu payload gốc vào `raw` (không trộn trường nội bộ) trong `api/sepay-webhook.js` + `lib/db.js`
- [ ] T022 [P] [US1] Tạo `lib/pricing.js` (giá ghế, combo, voucher theo `seats.html`/`combo.html`/`checkout.html`) và dùng trong `api/create-order.js`
- [ ] T023 [US1] Bỏ số điện thoại mặc định `'0987654321'` trong `api/create-order.js` và `api/reconcile.js`
- [ ] T024 [US1] Khi đơn PAID, chuyển `seat_holds` của đơn sang `SOLD` trong `lib/db.js`

**Checkpoint**: luồng thanh toán chuẩn an toàn, có test.

---

## Phase 4: User Story 2 — Trả thiếu & chuyển bù (P1)

- [ ] T025 [P] [US2] `tests/webhook.test.js`: thiếu còn hạn → PARTIAL, `remaining_amount` đúng; bù đủ → PAID
- [ ] T026 [P] [US2] `tests/webhook.test.js`: thiếu sau hạn → EXPIRED + refund SHORT 100% số đã nhận
- [ ] T027 [US2] Xác minh `underpay.html` hiển thị QR cho đúng `remaining_amount` từ `/api/order-status`

---

## Phase 5: User Story 3 — Trả thừa (P2)

- [ ] T028 [P] [US3] `tests/webhook.test.js`: thừa còn hạn → PAID + refund EXCESS = phần chênh
- [ ] T029 [P] [US3] `tests/webhook.test.js`: thừa sau hạn → EXPIRED + refund LATE 100%
- [ ] T030 [US3] Điền `bank_tx_id` khi tạo refund từ webhook (hỗ trợ unique `(bank_tx_id, reason)`) trong `api/sepay-webhook.js`

---

## Phase 6: User Story 4 — Thanh toán trễ (P2)

- [ ] T031 [P] [US4] `tests/webhook.test.js`: đủ tiền sau hạn → EXPIRED, `result=LATE`, refund 100%
- [ ] T032 [US4] Nhả ghế (xóa `seat_holds`) khi đơn chuyển EXPIRED/CANCELLED trong `lib/db.js`

---

## Phase 7: User Story 5 — Đối soát BetaBot (P2)

- [ ] T033 [P] [US5] `tests/reconcile.test.js`: giao dịch khớp, đơn còn hạn → `RECOVERED_PAID`
- [ ] T034 [P] [US5] `tests/reconcile.test.js`: đơn hết hạn → `RECOVERED_REFUND` có `refund_code`
- [ ] T035 [P] [US5] `tests/reconcile.test.js`: không tìm thấy giao dịch → `COMPLAINT_CREATED`; không mã → 400
- [ ] T036 [US5] `api/reconcile.js`: chỉ khôi phục khi `tx.order_id` hoặc `tx.code` khớp đúng đơn (tránh dùng giao dịch của đơn khác); cộng đúng `tx.amount`, áp dụng lại logic thiếu/thừa

---

## Phase 8: User Story 6 — Hoàn tiền (P3)

- [ ] T037 [P] [US6] `tests/refund.test.js`: gửi đủ 3 trường → RECEIVED, `acc_name` viết hoa; thiếu trường → 400
- [ ] T038 [US6] `api/refund.js`: bỏ số tiền mặc định `179000`; chỉ tự tạo hồ sơ khi đơn thực sự có tiền cần hoàn (`paid_amount > 0` và đơn EXPIRED/CANCELLED)
- [ ] T039 [US6] `api/refund.js` GET: lấy `order` theo `refund.order_id` thay vì `orderCode` từ query (đang trả null khi tra theo mã hồ sơ)

---

## Phase 9: User Story 7 — Lịch sử & tra cứu (P3)

- [ ] T040 [P] [US7] Chặn `limit` âm/NaN trong `api/orders.js`; yêu cầu `phone` (hoặc user) để không liệt kê đơn của người khác
- [ ] T041 [US7] Rà soát `account.html`, `invoice.html`, `ticket-*.html`: tách dữ liệu đơn hard-code (BC2885539882, BC2610208819, …) khỏi luồng thật, đánh dấu rõ là demo

---

## Phase 10: Polish & Cross-Cutting

- [ ] T042 [P] Khóa ghế thật: kiểm tra `error` khi insert `seat_holds`, xung đột → xóa đơn và trả 409 (`lib/db.js`, `api/create-order.js`); mô phỏng trong Mock Store; test trong `tests/create-order.test.js`
- [ ] T043 [P] Giới hạn kích thước body và trả 400 khi JSON lỗi trong `server.js`
- [ ] T044 [P] Viết `README.md` (cài đặt, biến môi trường, chạy test, quy trình Spec Kit)
- [ ] T045 Chạy `npm test` toàn bộ xanh và `quickstart.md` thủ công

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (chặn tất cả) → các user story.
- US1 (Phase 3) là MVP và là nền cho US2–US5 (cùng sửa `api/sepay-webhook.js`), nên làm tuần tự
  US1 → US2 → US3 → US4; US5, US6, US7 có thể song song sau US1.
- Trong mỗi story: viết test trước (phải fail), rồi implementation.

## Parallel Example: User Story 1

```text
T009–T015 (tests, cùng mới viết) song song với T022 (lib/pricing.js)
→ T016 → T017 → T018 → T019 → T020 → T021 (cùng file api/sepay-webhook.js, tuần tự)
```

## Implementation Strategy

1. Phase 1 + 2 ngay (bảo mật là rủi ro thực đang tồn tại).
2. Phase 3 (US1) → kiểm tra checkpoint → demo.
3. Lần lượt US2 → US4, rồi US5–US7, cuối cùng Polish.
