# Implementation Plan: Hệ thống đặt vé & thanh toán VietQR (Baseline toàn dự án)

**Branch**: `001-vietqr-payment-baseline` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-vietqr-payment-baseline/spec.md`

## Summary

Hệ thống đã có: frontend HTML tĩnh cho luồng đặt vé → cổng VietQR → vé/hoàn tiền, và 7 hàm API kiểu
Vercel (`api/*.js`) trên tầng dữ liệu `lib/db.js` (Supabase, dự phòng Mock Store). Kế hoạch này
(1) ghi lại kiến trúc hiện tại làm baseline, (2) thiết kế các thay đổi tối thiểu để đưa code về đúng
Constitution v1.0.0: gỡ bí mật khỏi repo, xác thực webhook, bỏ ghép đơn bằng phỏng đoán, tính giá ở
server, khóa ghế thật, chặn simulator ở production, và thêm bộ kiểm thử tình huống thanh toán.

## Technical Context

**Language/Version**: Node.js ≥ 18 (CommonJS); frontend HTML/CSS/JS thuần (không build)

**Primary Dependencies**: `@supabase/supabase-js` ^2.49, `dotenv` ^16.4

**Storage**: Supabase Postgres (`schema.sql`, RLS bật, không policy) + Mock Store in-memory

**Testing**: `node:test` + `node:assert` tích hợp sẵn (không thêm phụ thuộc), chạy `npm test`

**Target Platform**: Vercel Serverless Functions; local `node server.js` (cổng 3000)

**Project Type**: web-service + static web frontend trong cùng repo

**Performance Goals**: webhook xử lý < 1 s p95; trang thanh toán poll trạng thái mỗi 3–5 s

**Constraints**: idempotent theo `reference_code`; giữ ghế 10 phút; không bí mật trong repo

**Scale/Scope**: đồ án nhóm, ~20 trang HTML, 7 endpoint, 5 bảng; tải thấp (< 100 đơn/giờ)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Hiện trạng code | Kế hoạch | Sau thiết kế |
|---|---|---|---|
| I. Money Integrity | ❌ webhook tự ghép giao dịch không mã vào "đơn chờ gần nhất"; tự tạo đơn giả khi mã không tồn tại; `create-order` tin `total` từ client | Bỏ fallback, lưu `UNMATCHED`; tính giá ở server (R2, R3) | ✅ |
| II. Security First | ❌ Supabase secret key base64 hard-code trong `lib/db.js`; SePay API key thật trong `.env.example`; webhook không xác thực; simulator mở ở production | Gỡ key, xoay khóa, xác thực `Authorization: Apikey`, cờ `ENABLE_SIMULATOR` (R1, R4) | ✅ |
| III. State Machines | ⚠️ trạng thái đúng schema nhưng `seat_holds` insert lỗi bị nuốt; ghế trùng không bị chặn | Kiểm tra lỗi insert, trả 409 khi trùng ghế (R5) | ✅ |
| IV. Scenario Testing | ❌ không có kiểm thử, không có script `test` | Bộ test `node:test` trên Mock Store cho 7 tình huống (R6) | ✅ |
| V. Simplicity | ✅ không build, chạy được local/Vercel, có Mock Store | Giữ nguyên; không thêm phụ thuộc | ✅ |

Kết luận: các vi phạm là của code hiện có, không phải của thiết kế; tất cả được xử lý trong
`tasks.md`. Không cần mục Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-vietqr-payment-baseline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
/                         # Trang tĩnh (served as-is / clean URLs)
├── index.html, home.html, movie-detail.html, booking.html, seats.html, combo.html
├── checkout.html, gateway.html, underpay.html, overpay.html
├── ticket.html, ticket-cancelled.html, ticket-refunded.html, invoice.html
├── refund.html, refund-track.html, account.html, betabot.html, support.html
├── auth.html, login.html, register.html, verify.html
├── pay-client.js         # Client gọi /api, tạo đơn, chuyển sang gateway
├── quick-dock.js         # Thanh điều hướng nhanh
├── css/, images/, assets/, vendor/
├── api/                  # Vercel functions
│   ├── create-order.js   order-status.js   orders.js
│   ├── sepay-webhook.js  reconcile.js      refund.js
│   └── simulate-payment.js
├── lib/
│   ├── db.js             # Tầng dữ liệu Supabase + Mock Store
│   └── pricing.js        # (MỚI) Bảng giá ghế/combo/voucher dùng chung server
├── server.js             # Dev server: static + định tuyến /api
├── schema.sql            # Lược đồ Supabase
└── tests/                # (MỚI) node:test
    ├── helpers.js
    ├── webhook.test.js
    ├── reconcile.test.js
    ├── refund.test.js
    └── create-order.test.js
```

**Structure Decision**: giữ cấu trúc phẳng hiện có (static ở gốc + `api/` + `lib/`); chỉ thêm
`lib/pricing.js` và thư mục `tests/`.

## Complexity Tracking

Không có vi phạm cần biện minh.
