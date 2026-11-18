# Tasks: Baseline hệ thống Beta Cinemas

**Input**: `specs/001-baseline-he-thong/` (spec, plan, research, data-model, contracts)

**Ghi chú baseline**: các task `[X]` mô tả phần đã có trong code và đã được `npm test` (16/16) xác nhận.
Các task `[ ]` là việc còn lại rút ra từ Constitution Check (G1, G2) và các điểm thiếu kiểm thử.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup & nền tảng (đã có)

- [X] T001 Máy chủ dev + router API kiểu Vercel trong `server.js`
- [X] T002 Lớp lưu trữ Supabase / bộ nhớ trong trong `lib/store.js`
- [X] T003 Schema + RLS trong `schema.sql`, migrations idempotent trong `migrations/`
- [X] T004 Smoke test luồng chính trong `tools/smoke-test.js`

## Phase 2: User Story 1 – Đặt vé & thanh toán VietQR (P1) (đã có)

- [X] T005 [US1] Tính giá phía máy chủ, giữ ghế 10 phút trong `lib/flow.js` (`createOrder`, `claimSeats`)
- [X] T006 [US1] Webhook SePay có khóa trong `api/sepay-webhook.js`
- [X] T007 [US1] Lịch tra cứu Tầng 1 trong `lib/flow.js` (`TIER1_SCHEDULE`, `tick`)
- [X] T008 [US1] Vé QR ký HMAC trong `lib/ticket.js`; trang `ticket.html`

## Phase 3: User Story 2 – Cứu vé trước, hoàn tiền sau (P1)

- [X] T009 [US2] Tầng 2: cấp vé bù / chuyển hoàn trong `lib/flow.js` (`settleAfterHold`)
- [X] T010 [US2] Tầng 3: hoàn tự động có idempotency, quá hạn → MANUAL_REVIEW (`processRefund`, `escalateRefund`)
- [ ] T011 [US2] (G1) Lập lịch gọi `/api/cron` mỗi 30 phút với `CRON_SECRET` theo phương án chọn ở
      `research.md` R3 (pg_cron/GitHub Actions/Vercel Pro); giữ cron hằng ngày trong `vercel.json`
- [ ] T012 [US2] (G1) Ghi phương án lập lịch và cách kiểm tra vào `DEPLOY.md` mục 2 và 4
- [X] T013 [P] [US2] Thêm kiểm thử trong `tools/smoke-test.js`: tiền về muộn khi ghế còn → CONFIRMED_LATE;
      ghế đã bán → REFUND_REQUESTED lý do SEAT_TAKEN; còn < 30 phút → NEAR_SHOWTIME
- [X] T014 [P] [US2] Thêm kiểm thử trong `tools/smoke-test.js`: chuyển thừa → lệnh EXCESS; webhook gửi
      2 lần → chỉ 1 vé, 0 lệnh hoàn trùng

## Phase 4: User Story 3 – Hoàn tiền thủ công CSKH ↔ Kế toán (P2) (đã có)

- [X] T015 [US3] Luồng gửi / trả về / chi / hoàn tất + maker-checker trong `api/admin.js`
- [X] T016 [US3] Trang theo dõi hoàn tiền `refund-track.html`, form `refund.html`

## Phase 5: User Story 4 – Tài khoản thành viên (P2) (đã có)

- [X] T017 [US4] Đăng ký/đăng nhập/OTP/đổi mật khẩu trong `lib/auth.js`, `api/auth.js`
- [X] T018 [US4] Chặn dò mật khẩu trong `lib/throttle.js`
- [X] T019 [US4] Chỉ xem đơn của mình trong `api/orders.js`

## Phase 6: User Story 5 – Vận hành nội bộ (P3)

- [X] T020 [US5] Phân quyền vai trò `lib/staff.js`; danh mục `lib/catalog-admin.js`; tổng quan `lib/dashboard.js`
- [X] T021 [US5] Soát vé QR một lần trong `lib/ticket.js`
- [X] T022 [US5] (G2) Trong `api/admin.js`, ghi `Staff.audit` (await) trước khi trả phản hồi cho mọi POST
      thành công; lỗi ghi nhật ký phải được log phía máy chủ, không nuốt im lặng
- [X] T023 [P] [US5] Thêm kiểm thử trong `tools/smoke-test.js`: mỗi thao tác POST của `/api/admin`
      (danh mục, nhân sự, hoàn tiền, soát vé) tạo đúng một dòng `audit_logs`

## Phase 7: Polish

- [ ] T024 Chạy `npm test` sau T011–T023, cập nhật số kiểm thử trong `DEPLOY.md` nếu thay đổi
- [X] T025 Xóa Sync Impact Report (comment đầu file) khỏi `.specify/memory/constitution.md` trước khi commit

## Dependencies

- T012 sau T011. T024 sau mọi task khác. T013, T014, T023 độc lập nhau ([P]).
- T022 trước T023 (kiểm thử sẽ fail cho tới khi T022 xong nếu viết test trước).

## MVP / thứ tự đề xuất

1. T022 + T023 (nhỏ, rủi ro thấp, đóng G2).
2. T013 + T014 (tăng độ phủ cho luồng tiền).
3. T011 + T012 (cần chọn phương án lập lịch).
