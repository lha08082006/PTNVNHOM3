# Triển khai Beta Cinemas lên Vercel + Supabase

## 1. Cơ sở dữ liệu (Supabase → SQL Editor)

- **DB mới:** chạy toàn bộ `schema.sql`.
- **DB đang chạy:** chạy lần lượt (mỗi file chạy lại được, an toàn):
  1. `migrations/2026-11-18_quy-trinh-3-tang.sql`
  2. `migrations/2026-11-19_thanh-vien.sql` — bảng `customers`, `orders.user_id`, loại phiếu `GENERAL`
  3. `migrations/2026-11-20_ke-toan-tra-ve.sql` — tài khoản nhân viên (`staff`), nhật ký thao tác (`audit_logs`), trạng thái `ACC_RETURNED` (Kế toán trả hồ sơ về nhân viên)
  4. `migrations/2026-11-21_danh-muc-qr-otp.sql` — phim, rạp, suất chiếu, voucher (kèm dữ liệu khởi tạo), soát vé QR, quên mật khẩu. Sau đó vào **admin.html → Danh mục** tạo suất chiếu.
  5. `migrations/2026-11-22_dot-1-gia-ve-tin-tuc.sql` — loại vé (HSSV/U22, trẻ em, người cao tuổi), giá theo ngày/khung giờ, ngày lễ, tin tức & ưu đãi, thông tin phim chi tiết, tọa độ rạp. **Giá và bài viết trong file là mẫu** – sửa lại ở admin → Danh mục → Bảng giá / Tin tức & ưu đãi trước khi mở bán.
  6. `migrations/2026-11-23_voucher-dieu-kien-phan-hoi-phieu.sql` — voucher có điều kiện (giảm %, đơn tối thiểu, kèm bắp nước, theo thứ), khách xem & trả lời phản hồi CSKH
  7. `migrations/2026-11-24_dot-2-beta-club.sql` — Beta Club (điểm thưởng, hạng, quà sinh nhật), đánh giá phim, mua bắp nước riêng
  8. `migrations/2026-11-25_dot-3-phong-chieu-thue-rap.sql` — phòng chiếu có sơ đồ ghế riêng, thuê rạp / vé nhóm / Private Show, "Nhắc tôi khi mở bán"
  9. `migrations/2026-11-26_dot-4-cong-thanh-toan-hoa-don.sql` — phiên thanh toán VNPay / MoMo / ZaloPay, yêu cầu xuất hóa đơn điện tử
  10. `migrations/2026-11-27_dot-5-van-hanh-yeu-thich.sql` — ghi lỗi máy chủ, cảnh báo, trạng thái vận hành, phim yêu thích

> **API = 1 Serverless Function.** Gói Hobby của Vercel cho tối đa 12 function mỗi lần deploy, nên mọi `/api/<tên>` đi qua `api/[route].js` và logic nằm ở `lib/routes/<tên>.js`. Thêm API mới: tạo file trong `lib/routes/` và khai báo trong `lib/routes/index.js` — **không** tạo thêm file trong `api/`.

## 2. Biến môi trường (Vercel → Settings → Environment Variables)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | ✔ | Khóa service role, chỉ dùng phía máy chủ |
| `AUTH_SECRET` | ✔ | Chuỗi ngẫu nhiên ≥ 32 ký tự. Đổi giá trị này = đăng xuất mọi thành viên |
| `ADMIN_KEY` | ✔ | Chỉ dùng **một lần** để tạo tài khoản Quản lý đầu tiên trên `admin.html`; sau đó mỗi người đăng nhập bằng tài khoản riêng |
| `SEPAY_WEBHOOK_KEY` | ✔ | Đặt trùng với API Key trong cấu hình webhook SePay. Thiếu → webhook bị từ chối (503) |
| `SEPAY_API_KEY` | ✔ | Khóa API SePay **mới** (khóa cũ đã lộ trong lịch sử git, phải thu hồi) |
| `CRON_SECRET` | ✔ | Bảo vệ `/api/cron` (thiếu thì Job đối soát tự động bị tắt, trả 503) |
| `RESEND_API_KEY`, `MAIL_FROM` | tùy chọn | Gửi email vé/hoàn tiền thật. Trống → chỉ ghi nhận, không gửi |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | tùy chọn | Bật nút VNPay. Mặc định gọi **sandbox**; production đặt thêm `VNPAY_PAY_URL`, `VNPAY_API_URL`. Khai báo IPN URL `<SITE_URL>/api/pay?action=ipn&provider=vnpay` trên cổng VNPay |
| `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` | tùy chọn | Bật nút MoMo (sandbox mặc định; production đặt `MOMO_ENDPOINT=https://payment.momo.vn`) |
| `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` | tùy chọn | Bật nút ZaloPay (sandbox mặc định; production đặt `ZALOPAY_ENDPOINT=https://openapi.zalopay.vn`) |
| `ALERT_EMAILS` | tùy chọn | Email nhận cảnh báo hệ thống (cách nhau dấu phẩy). Trống → gửi cho mọi tài khoản Quản lý. Cần `RESEND_API_KEY` để gửi thật |
| `INVOICE_REQUEST_HOURS` | tùy chọn | Số giờ sau khi thanh toán khách còn được gửi yêu cầu hóa đơn (mặc định 24 – Kế toán xác nhận theo quy định) |
| `SITE_URL` | tùy chọn | Dùng cho link "Xem đơn hàng" trong email |
| `ALLOW_SANDBOX` | **không** đặt trên production | `1` = mở `/api/simulate-payment` (vẫn cần `x-admin-key`) cho UAT |

## 3. Kiểm tra trước khi deploy

```bash
npm test
```

Chạy toàn bộ luồng chính ở chế độ bộ nhớ trong: đăng ký/đăng nhập, tính giá phía máy chủ, chống trùng ghế,
quyền xem đơn, thanh toán sandbox, phiếu hỗ trợ, đổi mật khẩu, khóa webhook.

## 4. Sau khi deploy

- Đăng ký 1 tài khoản thật → đặt vé giá nhỏ → chuyển khoản VietQR → vé phải tự xuất trong vài giây.
- Mở `admin.html` → tạo tài khoản Quản lý đầu tiên bằng `ADMIN_KEY` → vào tab **Nhân sự & nhật ký** tạo tài khoản cho Kế toán, CSKH, Quầy.
- Kiểm tra đơn và nhật ký webhook ở tab IT / Dev.
- Gửi thử form ở `support.html` → phiếu "Yêu cầu hỗ trợ" phải hiện trong admin.

## 5. Checklist trước khi mở bán (Go-live)

Phải tự làm trên các dịch vụ bên ngoài, code không làm thay được:

- [ ] **Thu hồi khóa SePay cũ** (đã lộ trong lịch sử git), tạo khóa mới, đặt vào `SEPAY_API_KEY` / `SEPAY_WEBHOOK_KEY`.
- [ ] `AUTH_SECRET` ngẫu nhiên ≥ 32 ký tự; `ADMIN_KEY` mạnh, xóa đi sau khi đã tạo tài khoản Quản lý đầu tiên.
- [ ] **Không** đặt `ALLOW_SANDBOX`, **không** đặt `DB_MODE` trên production.
- [ ] Đặt `SITE_URL` (vd `https://beta.example.vn`): dùng cho link trong email, `sitemap.xml` và `robots.txt`.
- [ ] Xác minh tên miền gửi mail trên Resend, đặt `RESEND_API_KEY`, `MAIL_FROM`; thử "Quên mật khẩu" phải nhận được mã OTP.
- [ ] Chạy đủ các migration (mục 1), vào admin.html → Danh mục: kiểm tra phim, rạp, giá; tạo suất chiếu 7 ngày tới.
- [ ] **UAT bằng tiền thật, số tiền nhỏ** (mỗi ca một đơn):
  - [ ] Chuyển đủ → vé xuất trong vài giây, có email, QR soát được 1 lần ở tab Quầy.
  - [ ] Chuyển thiếu, chờ hết 10 phút → hồ sơ hoàn tiền SHORT, tiền về trong 24 giờ.
  - [ ] Chuyển thừa → vẫn có vé + hồ sơ hoàn EXCESS.
  - [ ] Chuyển sau khi hết 10 phút → cấp vé bù (ghế còn) hoặc hoàn tiền.
  - [ ] Hồ sơ hoàn tiền thủ công: CSKH gửi → Kế toán trả về → gửi lại → chi → hoàn tất.
- [ ] Rà lại nội dung `policy.html` (điều khoản, bảo mật, hoàn tiền) với người phụ trách pháp lý/kế toán trước khi công bố.
- [ ] Gửi `https://<tên-miền>/sitemap.xml` lên Google Search Console.

### Giám sát & sao lưu (Đợt 5)

- Đăng ký một dịch vụ giám sát miễn phí (UptimeRobot, Better Stack…) gọi `https://<tên-miền>/api/health` mỗi 5 phút: trả 503 = database không trả lời.
- Hệ thống tự gửi email cảnh báo cho Quản lý khi: lỗi máy chủ dồn dập, webhook / IPN bị từ chối liên tục (sai khóa), Job hằng ngày lỗi, hồ sơ hoàn tiền thủ công quá 24 giờ. Xem lại ở admin.html → IT / Dev → Tình trạng hệ thống.
- Sao lưu: admin.html → IT / Dev → **Tải bản sao lưu dữ liệu**, hoặc trên máy có `.env`: `npm run backup` (file vào thư mục `backups/`). Nên làm mỗi tuần, cất ở nơi an toàn (file có dữ liệu khách hàng).
- Ảnh mới: chạy `node tools/optimize-images.js --write` để tạo bản WebP + bản 800px cho điện thoại. Đo tốc độ: `node tools/perf.js http://localhost:5000`.

### Theo dõi hằng ngày sau khi mở bán

- admin.html → IT / Dev: nhật ký webhook. Webhook lỗi 401/503 liên tục = sai khóa SePay.
- admin.html → CSKH, bộ lọc **Cần xử lý**: hồ sơ `MANUAL_REVIEW` (quá 24 giờ chưa tự hoàn được) phải xử lý trong ngày.
- Vercel → Cron: `/api/cron` phải chạy thành công mỗi ngày.

## Ghi chú

- Vai trò nội bộ: **Quản lý** (toàn quyền, nhân sự, nhật ký, IT), **Kế toán** (duyệt chi / trả về, báo cáo), **CSKH** (phiếu hỗ trợ, đối chiếu & gửi hồ sơ hoàn tiền), **Quầy** (tra cứu đơn). Người gửi hồ sơ sang Kế toán không được tự duyệt chi hồ sơ đó.

- Giá vé, combo, voucher, danh sách phim nằm ở `catalog.js` (dùng chung cho trình duyệt và máy chủ). Sửa giá = sửa file này rồi deploy.
- Thanh điều hướng thiết kế (⚡ quick-dock) và bảng sandbox trên trang VietQR chỉ hiện ở `localhost` (hoặc thêm `?dev=1` / `?sandbox=1`).
