# Beta Cinemas – Đặt vé & Thanh toán VietQR Constitution

## Core Principles

### I. Máy chủ là nguồn sự thật về tiền

- Giá vé, combo, voucher và tổng tiền MUST được tính lại phía máy chủ từ danh mục
  (`catalog.js` / bảng danh mục); mọi giá trị tiền do trình duyệt gửi lên MUST bị bỏ qua.
- Trạng thái thanh toán MUST chỉ được xác lập từ giao dịch ngân hàng (webhook SePay hoặc
  tra cứu cổng), không bao giờ từ khai báo của khách.
- Tiền MUST lưu bằng số nguyên VND (`bigint`), không dùng số thực.

**Lý do**: hệ thống nhận tiền thật; một lỗ hổng sửa giá phía client là mất tiền trực tiếp.

### II. Idempotent & compare-and-set cho mọi thao tác tiền/vé

- Mọi handler webhook, cron, tra cứu trạng thái và hoàn tiền MUST chạy lại nhiều lần mà
  không tạo vé trùng, ghế trùng hay lệnh hoàn trùng.
- Đổi trạng thái đơn/hoàn tiền MUST dùng compare-and-set (chỉ cập nhật khi trạng thái hiện
  tại vẫn là trạng thái mong đợi).
- Lệnh hoàn tiền MUST mang `idempotency_key` duy nhất (BR-04); ghế MUST được khóa bằng
  khóa chính (suất, ghế) để bảo đảm 0 bán trùng ghế.

**Lý do**: webhook trùng, nhiều tab hỏi trạng thái và cron chạy chồng là chuyện bình thường.

### III. "Cứu vé trước – Hoàn tiền sau" (quy trình đối soát 3 tầng)

- Tầng 1 (10 phút giữ ghế): chờ webhook → short polling → final check → lần chốt.
- Tầng 2 (cửa sổ 24 giờ): job 30 phút quét đơn EXPIRED, kiểm tra chéo (BR-01), cấp vé bù
  nếu ghế còn và còn ≥ 30 phút trước giờ chiếu (BR-03), ngược lại chuyển hoàn tiền.
- Tầng 3: hoàn tự động trong hạn 24 giờ (BR-05); quá hạn → MANUAL_REVIEW + RefundForm +
  phiếu hỗ trợ (BR-06).
- Thay đổi thời gian, ngưỡng hay luật BR-xx MUST đi kèm cập nhật `CONFIG` trong `lib/flow.js`,
  tài liệu và kiểm thử; không được để khách mất tiền mà không có đường hoàn.

**Lý do**: đây là cam kết nghiệp vụ cốt lõi với khách hàng.

### IV. Phân quyền theo vai trò, tách nhiệm và truy vết

- Mỗi nhân viên MUST đăng nhập bằng tài khoản riêng; quyền theo vai trò MANAGER /
  ACCOUNTANT / CS / COUNTER được kiểm tra phía máy chủ (`Staff.guard`).
- Người gửi hồ sơ hoàn tiền sang Kế toán MUST NOT tự duyệt chi hồ sơ đó (maker-checker).
- Mọi thao tác nhân viên làm đổi tiền, trạng thái, danh mục hay nhân sự MUST ghi
  `audit_logs`; mọi chuyển trạng thái đơn MUST ghi vào `history`.
- Khách hàng MUST chỉ xem được đơn của chính mình.

**Lý do**: nghiệp vụ hoàn tiền thủ công cần kiểm soát nội bộ và khả năng đối soát.

### V. Bí mật và môi trường được khóa chặt

- Khóa service role, `AUTH_SECRET`, khóa SePay/Resend MUST chỉ nằm ở biến môi trường phía
  máy chủ; không commit vào git, không gửi xuống trình duyệt.
- Webhook MUST từ chối khi thiếu hoặc sai `SEPAY_WEBHOOK_KEY`; sandbox thanh toán MUST tắt
  trên production (chỉ mở khi `ALLOW_SANDBOX=1` và có khóa quản trị).
- Đăng nhập/OTP MUST có chặn dò (throttle); mật khẩu MUST được băm; vé QR MUST ký HMAC và
  soát một lần.
- Mọi bảng Supabase MUST bật RLS; truy cập dữ liệu đi qua API máy chủ.

**Lý do**: khóa SePay đã từng lộ trong lịch sử git — không lặp lại.

### VI. Kiểm thử luồng chính trước khi phát hành

- `npm test` (smoke test chạy bộ nhớ trong) MUST đạt 100% trước mỗi deploy.
- Mỗi luồng tiền/vé/quyền mới hoặc thay đổi MUST thêm hoặc cập nhật ca kiểm thử trong
  `tools/smoke-test.js`.
- Thay đổi schema MUST có file migration chạy lại được (idempotent) trong `migrations/` và
  đồng bộ `schema.sql`.

**Lý do**: không có QA riêng; smoke test là lưới an toàn duy nhất.

## Ràng buộc kỹ thuật & bảo mật

- Ngăn xếp: Node.js (CommonJS), trang HTML tĩnh + API kiểu Vercel Serverless (`api/*.js`),
  máy chủ phát triển `server.js`, Supabase Postgres, SePay/VietQR, Resend (email tùy chọn).
- Phụ thuộc runtime giữ tối thiểu (`@supabase/supabase-js`, `dotenv`); thêm thư viện mới
  MUST có lý do rõ ràng.
- Giao diện và thông báo cho người dùng viết bằng tiếng Việt.
- Công cụ dev (quick-dock, bảng sandbox) MUST chỉ hiện trên localhost hoặc khi bật cờ dev.

## Quy trình phát triển & cổng chất lượng

- Làm việc trên nhánh tính năng; commit theo Conventional Commits (`feat(...)`, `fix(...)`).
- Trước khi merge: `npm test` đạt, migration (nếu có) đã ghi trong `DEPLOY.md`, biến môi
  trường mới đã liệt kê trong bảng ở `DEPLOY.md`.
- Tính năng lớn đi theo Spec Kit: `/speckit-specify` → `/speckit-plan` (qua Constitution
  Check) → `/speckit-tasks` → `/speckit-implement`.

## Governance

- Constitution này đứng trên các thói quen khác của dự án; review MUST kiểm tra tuân thủ
  các nguyên tắc I–VI.
- Sửa đổi: ghi lý do, cập nhật Sync Impact Report, tăng phiên bản theo semver (MAJOR: bỏ/định
  nghĩa lại nguyên tắc; MINOR: thêm nguyên tắc/mục; PATCH: diễn đạt).
- Vi phạm MUST được ghi rõ ở bảng Complexity Tracking trong `plan.md` kèm lý do.

**Version**: 1.0.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-11-18
