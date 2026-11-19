# Beta Cinemas Payment Constitution

## Core Principles

### I. Tiền của khách là bất khả xâm phạm (Money Integrity — NON-NEGOTIABLE)

- Mọi khoản tiền VÀO mà cổng ngân hàng (SePay) báo về MUST được ghi vào sổ cái giao dịch
  (`bank_transactions`) kèm payload gốc, kể cả khi không khớp được đơn (`UNMATCHED`).
- Mỗi giao dịch MUST được xử lý đúng một lần (idempotent theo mã tham chiếu ngân hàng);
  webhook gửi lặp lại MUST NOT cộng tiền hai lần.
- Số tiền phải trả MUST được tính/xác nhận ở server; giá trị `total` do trình duyệt gửi lên
  MUST NOT được tin tưởng tuyệt đối.
- Một giao dịch MUST NOT được ghép vào đơn hàng chỉ dựa trên phỏng đoán (ví dụ "đơn đang chờ gần
  nhất"); khi không xác định được mã đơn, giao dịch được đánh dấu `UNMATCHED` để đối soát.
- Mọi khoản trả thiếu, trả thừa, trả trễ hoặc trùng MUST sinh hồ sơ hoàn tiền (`refunds`) hoặc
  khiếu nại (`complaints`) truy vết được; tiền không bao giờ được "biến mất" khỏi hệ thống.

Rationale: đây là hệ thống thanh toán thật; sai sót về tiền gây thiệt hại trực tiếp và mất uy tín.

### II. Bảo mật & Bí mật (Security First)

- Khóa bí mật (Supabase service key, SePay API key, …) MUST chỉ nằm trong biến môi trường;
  MUST NOT được commit vào repo, kể cả dưới dạng base64 hay trong `.env.example`.
- Endpoint webhook MUST xác thực nguồn gửi (API key / chữ ký của SePay) trước khi ghi nhận tiền.
- Các bảng dữ liệu MUST bật RLS; trình duyệt chỉ truy cập dữ liệu qua `/api/*` chạy ở server.
- Công cụ giả lập (`/api/simulate-payment`) MUST bị tắt ở môi trường production.
- Dữ liệu cá nhân (số điện thoại, số tài khoản hoàn tiền) chỉ được trả về cho đúng chủ đơn.

Rationale: một khóa bị lộ hoặc webhook giả mạo có thể "xuất vé miễn phí" hoặc làm lộ dữ liệu khách.

### III. Máy trạng thái rõ ràng (Explicit State Machines)

- Đơn hàng chỉ có các trạng thái `HOLDING → PARTIAL → PAID | EXPIRED | CANCELLED`; hồ sơ hoàn tiền
  chỉ có `WAITING_INFO → RECEIVED → RECONCILING → APPROVED → DONE`.
- Mọi chuyển trạng thái MUST đi qua tầng dữ liệu (`lib/db.js`) và MUST khớp ràng buộc `check`
  trong `schema.sql`; thêm trạng thái mới MUST cập nhật schema, API và giao diện cùng lúc.
- Thời gian giữ ghế là 10 phút và là nguồn sự thật duy nhất cho quyết định "trễ" (`LATE`).

Rationale: các tình huống thiếu/thừa/trễ chỉ an toàn khi chuyển trạng thái có thể dự đoán và kiểm thử.

### IV. Kiểm thử các tình huống thanh toán (Scenario Testing)

- Mỗi tình huống thanh toán (OK, SHORT, EXCESS, LATE, DUPLICATE, NETWORK_LAG/đối soát, UNMATCHED)
  MUST có ít nhất một kiểm thử tự động chạy được bằng `npm test` với Mock Store, không cần mạng.
- Mọi thay đổi ở `api/sepay-webhook.js`, `api/reconcile.js`, `api/refund.js` hoặc `lib/db.js`
  MUST kèm kiểm thử tương ứng và MUST giữ toàn bộ kiểm thử xanh.

Rationale: luồng tiền phức tạp; kiểm thử là cách duy nhất chứng minh không có hồi quy.

### V. Đơn giản & Chạy được ở mọi nơi (Simplicity & Portability)

- Frontend là HTML/CSS/JS tĩnh, không bước build; backend là các hàm kiểu Vercel trong `api/`
  chạy được cả bằng `node server.js` lẫn trên Vercel mà không sửa code.
- Tầng dữ liệu MUST hoạt động khi chưa có Supabase (Mock Store) để demo và kiểm thử.
- Không thêm framework/phụ thuộc mới nếu chưa có lý do ghi trong `plan.md` (mục Complexity).
- Nội dung hiển thị cho người dùng dùng tiếng Việt; dữ liệu demo/hard-code MUST được đánh dấu rõ
  và tách khỏi luồng production.

Rationale: dự án nhóm, cần dễ chạy, dễ demo và dễ bảo trì.

## Ràng buộc kỹ thuật (Technical Constraints)

- Runtime: Node.js (CommonJS), phụ thuộc chính `@supabase/supabase-js`, `dotenv`.
- Lưu trữ: Supabase/Postgres theo `schema.sql`; Mock Store in-memory làm dự phòng.
- Thanh toán: chuyển khoản VietQR, nhận biến động qua webhook SePay; nội dung chuyển khoản chứa
  mã đơn dạng `BC##########`.
- Triển khai: Vercel (`vercel.json`, clean URLs); dev local bằng `npm start` (cổng mặc định 3000).
- `localStorage` chỉ dùng cho tiện ích giao diện, MUST NOT là nguồn sự thật về trạng thái tiền.

## Quy trình phát triển (Development Workflow)

- Tính năng mới đi theo Spec Kit: `/speckit-specify` → (`/speckit-clarify`) → `/speckit-plan`
  → `/speckit-tasks` → (`/speckit-analyze`) → `/speckit-implement`; tài liệu nằm ở `specs/NNN-*/`.
- Mỗi `plan.md` MUST có mục Constitution Check đối chiếu năm nguyên tắc trên.
- Commit theo Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Review MUST kiểm tra: không lộ bí mật, không phá idempotency, kiểm thử xanh.

## Governance

- Constitution này có hiệu lực cao hơn mọi thói quen/tài liệu khác của dự án.
- Sửa đổi phải qua `/speckit-constitution`, kèm lý do, và được ít nhất một thành viên nhóm duyệt.
- Phiên bản theo SemVer: MAJOR khi bỏ/định nghĩa lại nguyên tắc; MINOR khi thêm nguyên tắc/mục;
  PATCH khi sửa câu chữ.
- Vi phạm hiện có trong code được theo dõi như nợ kỹ thuật trong `specs/*/tasks.md` cho tới khi
  được xử lý.

**Version**: 1.0.0 | **Ratified**: 2026-11-19 | **Last Amended**: 2026-11-19
