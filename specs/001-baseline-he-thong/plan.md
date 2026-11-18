# Implementation Plan: Baseline hệ thống Beta Cinemas

**Branch**: `feat/quy-trinh-doi-soat-3-tang` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-baseline-he-thong/spec.md`

## Summary

Spec baseline cho hệ thống đã chạy: đặt vé → VietQR (SePay) → xuất vé QR ký số, kèm bộ máy đối soát
3 tầng "Cứu vé trước – Hoàn tiền sau", hoàn tiền thủ công CSKH ↔ Kế toán, tài khoản thành viên và
trang quản trị phân quyền. Plan này ghi lại kiến trúc hiện tại, đối chiếu với constitution v1.0.0 và
nêu các khoảng hở cần xử lý (xem *Khoảng hở phát hiện*).

## Technical Context

**Language/Version**: Node.js 22 (CommonJS), HTML/CSS/JS thuần phía trình duyệt

**Primary Dependencies**: `@supabase/supabase-js` 2.x, `dotenv`; dev: `puppeteer-core` (chụp mockup)

**Storage**: Supabase Postgres (RLS bật trên mọi bảng); chế độ bộ nhớ trong khi không có `SUPABASE_URL`
(dùng cho smoke test và dev)

**Testing**: `npm test` → `tools/smoke-test.js` (16 kiểm thử luồng chính, hiện đạt 16/16)

**Target Platform**: Vercel (trang tĩnh + Serverless Functions `api/*.js`), `server.js` cho dev local

**Project Type**: web-service + web app tĩnh (một repo, không bundler)

**Performance Goals**: xuất vé ≤ 10 giây sau khi tiền về (SC-001)

**Constraints**: idempotent trên mọi luồng tiền; body tối đa 8 MB (ảnh biên lai); Vercel cron gói hiện
tại chạy 1 lần/ngày

**Scale/Scope**: ~40 trang HTML, 14 API handler, 12 module `lib/`, 18 bảng

## Constitution Check

| Nguyên tắc | Trạng thái | Bằng chứng |
|---|---|---|
| I. Máy chủ là nguồn sự thật về tiền | ✅ Đạt | `Flow.createOrder` tính giá từ `catalog.js`/DB; kiểm thử "Máy chủ tự tính giá" |
| II. Idempotent & CAS | ✅ Đạt | `transition()` compare-and-set; `refunds.idempotency_key` unique; PK `seat_holds(showtime_key, seat)` |
| III. Đối soát 3 tầng | ⚠️ Một phần | Logic đủ trong `lib/flow.js`, nhưng job 30 phút **không** có lịch chạy thật — xem G1 |
| IV. Phân quyền, tách nhiệm, truy vết | ⚠️ Một phần | `Staff.guard` + maker-checker đạt; nhật ký ghi kiểu "fire-and-forget" — xem G2 |
| V. Bí mật & môi trường | ✅ Đạt | scrypt, HMAC token/QR, throttle, webhook key bắt buộc, sandbox khóa, RLS, `.env` trong `.gitignore` |
| VI. Kiểm thử trước phát hành | ✅ Đạt | 16/16 smoke test; migrations idempotent; `DEPLOY.md` cập nhật |

**Kết luận gate**: được phép tiếp tục; G1 và G2 là việc khắc phục (đưa vào tasks), không cần ghi ngoại lệ.

### Khoảng hở phát hiện

- **G1 – Job Tầng 2/3 chỉ chạy 1 lần/ngày.** `vercel.json` đặt cron `0 1 * * *`, trong khi FR-007/FR-010
  và constitution III yêu cầu quét mỗi 30 phút. Hiện job chỉ được kích thêm khi khách mở trang trạng
  thái đơn (`api/order-status`, `api/orders`, `api/refund` gọi `Flow.tick`). Khách đóng tab → tiền về
  muộn có thể chờ tới ~24 giờ, dễ trượt hạn hoàn tự động 24 giờ và rơi vào xử lý thủ công.
- **G2 – Nhật ký thao tác có thể mất im lặng.** `api/admin.js` gọi `Staff.audit(...).catch(() => {})`
  sau khi đã trả kết quả; lỗi ghi `audit_logs` bị nuốt, trái SC-005 (100% truy vết được).
- **G3 – Kênh SMS chỉ ghi nhận** (đã nêu ở Assumptions; không phải vi phạm).

## Project Structure

### Documentation (this feature)

```text
specs/001-baseline-he-thong/
├── spec.md
├── plan.md              # file này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
*.html, *-client.js, catalog.js, quick-dock.js   # giao diện tĩnh (khách + admin.html)
api/                  # Serverless handler: auth, catalog, create-order, order-status, orders,
                      # seats, sepay-webhook, reconcile, refund, report-issue, support, cron,
                      # admin, simulate-payment
lib/
├── flow.js           # bộ máy 3 tầng, hoàn tiền, xử lý giao dịch đến
├── store.js          # Supabase hoặc bộ nhớ trong
├── gateway.js        # tra cứu SePay
├── auth.js, throttle.js, staff.js, ticket.js, mailer.js
├── catalog-db.js, catalog-admin.js, dashboard.js, api-util.js
schema.sql, migrations/    # DB
server.js                  # máy chủ dev
tools/smoke-test.js        # kiểm thử
```

**Structure Decision**: giữ cấu trúc một repo hiện tại (trang tĩnh + `api/` + `lib/`); không thêm bundler.

## Complexity Tracking

Không có vi phạm cần biện minh.
