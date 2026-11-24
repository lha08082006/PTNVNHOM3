# Beta Cinemas – Bối cảnh toàn bộ dự án

> Cập nhật: 2026-11-21 (sau commit `a40df13`).
> Dùng để bàn giao cho thành viên mới hoặc dán vào một AI khác để nó hiểu dự án mà không phải đọc lại toàn bộ mã nguồn.
> File này **không chứa khóa bí mật**: chỉ có tên biến môi trường, không có giá trị.

---

## 1. Tóm tắt

Web đặt vé xem phim cho chuỗi rạp **Beta Cinemas** (đồ án nhóm, mã repo `PTNVNHOM3`). Trọng tâm nghiệp vụ là **quy trình đối soát thanh toán 3 tầng "Cứu vé trước – Hoàn tiền sau"**: khách chuyển khoản VietQR (qua SePay), hệ thống tự khớp tiền với đơn, tự xử lý chuyển thiếu / thừa / trễ / webhook thất lạc, cấp vé bù hoặc hoàn tiền, và có công cụ nội bộ cho CSKH, Kế toán, Quầy, Quản lý.

Định vị sản phẩm: **"Đặt vé Beta: rẻ nhất, nhanh nhất, không bao giờ mất tiền oan."**

Hiện trạng (21/11/2026): web thật đã nối Supabase, đủ 34 bảng, có lịch chiếu 14 ngày cho 9 rạp (tự gia hạn mỗi đêm), đã thanh toán thử bằng tiền thật thành công (webhook SePay khớp đơn), vé dùng **mã vạch Code 128**.

---

## 2. Địa chỉ và tài nguyên

| Thứ | Giá trị |
|---|---|
| Web thật (đang dùng) | https://ptnvnhom3betacinemas.vercel.app — project Vercel `ptnvnhom3betacinemas` (team lha, gói Hobby) |
| Địa chỉ cũ | https://ptnvnhom3.vercel.app — **project Vercel khác**, không có biến môi trường, đang hiện "bảo trì". Nên xóa hoặc chuyển tên miền sang project đang dùng |
| Mã nguồn | GitHub `lha08082006/PTNVNHOM3`, nhánh mặc định `main` (Vercel tự deploy khi `main` đổi). Nhánh làm việc: `feat/dot-1-nang-cap`, `feat/quy-trinh-doi-soat-3-tang` (đều trùng `main`) |
| Database | Supabase (PostgreSQL + Storage), cùng khu vực châu Á; hàm Vercel chạy ở `sin1` (Singapore) cho gần database |
| Thanh toán | VietQR qua **SePay**, ngân hàng MSB (tài khoản ảo SePay). Số tài khoản trong mã QR đang ghi cứng ở `gateway.html` và `underpay.html`, trùng `SEPAY_ACCOUNT_NUMBER` |
| Email | Resend (tùy chọn – chưa cấu hình thì chỉ ghi nhận, không gửi) |
| Tài liệu khác | `DEPLOY.md` (triển khai), `specs/001-baseline-he-thong/` (đặc tả Spec Kit: spec, plan, data-model, tasks), `docs/diagrams/*.drawio` (sơ đồ quy trình, sơ đồ lớp) |

---

## 3. Công nghệ và kiến trúc

- **Không dùng framework.** Giao diện là các trang HTML tĩnh + JavaScript thuần; máy chủ là Node.js (cần Node ≥ 18 vì dùng `fetch` có sẵn). Phụ thuộc chạy: `@supabase/supabase-js`, `dotenv`. Phụ thuộc kiểm thử: `puppeteer-core`, `axe-core`.
- **Một Serverless Function duy nhất** trên Vercel: mọi `/api/<tên>` đi qua `api/[route].js` → bảng định tuyến `lib/routes/index.js` → `lib/routes/<tên>.js`. (Gói Hobby giới hạn 12 function; thêm API mới thì tạo file trong `lib/routes/` và khai báo ở `index.js`, **không** tạo file mới trong `api/`.)
- **Máy chủ chạy ở máy:** `server.js` phục vụ file tĩnh + cùng bảng định tuyến API, và tự chạy Job đối soát định kỳ.
- **Tầng dữ liệu `lib/store.js`:** chọn **một lần** lúc khởi động giữa Supabase và bộ nhớ trong (`DB_MODE=mock`). Không bao giờ âm thầm chuyển qua lại.
  - Chốt an toàn: trên Vercel production (hoặc `REQUIRE_DB=1`) mà thiếu / sai cấu hình Supabase thì **không** chạy bộ nhớ tạm. Đặt vé, đăng ký, webhook bị khóa (503), trang khách hiện dải đỏ bảo trì, `/api/health` trả 503.
  - `Store.find` tự đọc theo trang khi cần hơn 1.000 dòng (giới hạn của Supabase) và tự chia nhỏ bộ lọc `in` dài (giữ URL ngắn).
- **Vercel (`vercel.json`):** `regions: ["sin1"]`, `cleanUrls` (bỏ `.html` trên đường dẫn), rewrite `/` → `/home`, `/phim/:slug` → `/api/movie-page`, `/sitemap.xml` và `/robots.txt` → `/api/sitemap`; cron `/api/cron` lúc `0 1 * * *` UTC (08:00 giờ VN); header bảo mật (CSP, HSTS, X-Frame-Options…).
- **PWA:** `sw.js` (phiên bản `beta-v5`) lưu trang và tài nguyên để xem vé khi mất mạng; `manifest.webmanifest`.
- **Song ngữ:** `lang.js` + từ điển `i18n/en.json` (khóa là câu tiếng Việt), bật bằng nút EN/VI hoặc `?lang=en`.
- **Mã vạch vé:** `barcode.js` tự sinh Code 128 (SVG / canvas), không cần thư viện ngoài.

```
Trình duyệt (HTML tĩnh + pay-client.js / auth-client.js / site-chrome.js / lang.js / barcode.js)
      │  fetch /api/<tên>
      ▼
api/[route].js ──► lib/routes/<tên>.js ──► lib/*.js (flow, gateway, ticket, staff, catalog-db…)
                                                │
                                                ▼
                                    lib/store.js ──► Supabase (thật) │ bộ nhớ trong (DB_MODE=mock)
SePay ──webhook──► /api/sepay-webhook      Vercel Cron ──► /api/cron (Job đối soát, thư nhắc, gia hạn lịch)
```

---

## 4. Cấu trúc thư mục

```
*.html                 33 trang (xem mục 5)
api/[route].js         function duy nhất trên Vercel
lib/                   logic máy chủ
  routes/              22 API (xem mục 6)
  store.js             Supabase hoặc bộ nhớ trong; chẩn đoán cấu hình
  flow.js              bộ máy đối soát 3 tầng (trái tim nghiệp vụ)
  gateway.js           "cổng thanh toán": tra cứu sổ cái + API SePay, đọc mã đơn, lệnh hoàn (mô phỏng)
  ticket.js            mã vé ký số (mã vạch + QR cũ), soát vé tại quầy
  access.js            ai được xem gì của một đơn
  auth.js / throttle.js / ratelimit.js   tài khoản khách, chặn dò mật khẩu, chặn spam theo IP
  staff.js / totp.js   tài khoản nhân viên, phân quyền, nhật ký, đăng nhập 2 lớp
  catalog-db.js / catalog-admin.js       phim, rạp, suất, giá, voucher, phòng chiếu (đọc / quản lý)
  backoffice.js / dashboard.js           công cụ Kế toán, CSKH, Quầy; số liệu tổng quan
  points.js / reviews.js / movie-stats.js  Beta Club, đánh giá phim, xếp hạng bán chạy
  payments.js          khung cổng VNPay / MoMo / ZaloPay (bật khi có khóa)
  einvoice.js / events.js / campaigns.js / posts.js / banners.js / media.js
  reminders.js         thư nhắc suất chiếu, mời đánh giá, sinh nhật, điểm sắp hết hạn
  schedule-extend.js   tự gia hạn lịch chiếu mỗi đêm
  schema-check.js + schema-columns.js (tự sinh)   tự kiểm tra database đủ bảng / cột
  pay-diag.js          tự chẩn đoán cấu hình SePay
  ops.js / mailer.js   log lỗi, cảnh báo, trạng thái vận hành; gửi email (Resend)
catalog.js             danh mục dùng chung trình duyệt + máy chủ: giá mặc định, combo, Beta Club, hàm tính tiền
pay-client.js          gọi API từ trình duyệt, lưu vé offline
auth-client.js         phiên đăng nhập khách ở trình duyệt
site-chrome.js         đầu / chân trang dùng chung, menu ☰, tìm kiếm, banner cài app, dải bảo trì
schema.sql             cấu trúc đầy đủ (database mới chạy file này)
migrations/            14 migration theo ngày + file gộp + file dữ liệu mẫu (mục 10)
tools/                 kiểm thử, sinh dữ liệu, tối ưu ảnh, sao lưu (mục 12)
css/, images/, vendor/, i18n/, assets/
```

---

## 5. Các trang

Vercel bật `cleanUrls`: `/home.html` phục vụ tại `/home`.

| Trang | Mục đích |
|---|---|
| `home.html` (`/`) | Trang chủ: banner (Quản lý đổi trong admin), thanh **Mua vé nhanh** 4 bước, phim đang / sắp chiếu, hạng bán chạy, điểm ★, tin tức |
| `movie-detail.html` (`/phim/<mã>`) | Chi tiết phim; máy chủ chèn sẵn SEO / Open Graph / schema.org. Chọn rạp → ngày → suất, đánh giá, phim liên quan, "Nhắc tôi khi mở bán" |
| `booking.html` | Chọn suất theo phim: 7 ngày tới + ô "Ngày khác" |
| `schedule.html` | Lịch chiếu theo rạp và ngày, lọc định dạng |
| `rap.html` | Danh sách rạp và trang chi tiết rạp (`?id=`): địa chỉ, hotline, ảnh, tiện ích, phòng, suất 7 ngày |
| `seats.html` | Sơ đồ ghế theo phòng, **Chọn giúp tôi** (ghế đẹp nhất), giữ ghế 10 phút khi thanh toán |
| `combo.html`, `bap-nuoc.html` | Chọn combo kèm vé; mua bắp nước riêng (xem menu không cần đăng nhập) |
| `checkout.html` | Xác nhận đơn, voucher, điểm Beta Club, đồng ý điều khoản |
| `gateway.html` | Trang VietQR: mã QR, số tiền, nội dung `BC…`, đồng hồ 10 phút, trạng thái đối soát; bảng **Sandbox** chỉ hiện trên máy (`localhost`) |
| `underpay.html` / `overpay.html` | Chuyển thiếu (chuyển bù) / chuyển thừa (vé đã cấp + hoàn phần thừa) |
| `verify.html` | Đang xác minh giao dịch |
| `ticket.html` | Vé điện tử: **mã vạch soát vé**, lưu ảnh vé, thêm vào lịch, mời bạn, gửi lại email, in |
| `order.html`, `account.html` | Theo dõi đơn; tài khoản thành viên (đơn, điểm, hạng, yêu thích, dữ liệu cá nhân) |
| `refund.html`, `refund-track.html` | Biểu mẫu nhận hoàn tiền (khi phải xử lý thủ công); theo dõi hoàn tiền |
| `ticket-cancelled.html`, `ticket-refunded.html` | Chi tiết đơn đã hủy / đã hoàn |
| `support.html`, `betabot.html` | Trung tâm hỗ trợ / khiếu nại; trợ lý BetaBot (tra đối soát, trả lời theo trạng thái đơn thật) |
| `auth.html`, `login.html`, `register.html` | Đăng nhập / đăng ký / quên mật khẩu (OTP) |
| `gia-ve.html`, `tin-tuc.html`, `policy.html`, `thue-rap.html` | Bảng giá; tin tức & ưu đãi; chính sách; thuê rạp / vé nhóm / Private Show |
| `invoice.html` | Hóa đơn bán hàng điện tử |
| `admin.html` | **Trang nội bộ** (mục 8): menu trái theo nhóm – Tổng quan, Quầy soát vé, Chăm sóc khách hàng, Kế toán, Danh mục (6 mục con), IT / Vận hành, Nhân sự & nhật ký; mỗi vai trò mở thẳng tab của mình |
| `offline.html`, `404.html`, `showcase.html` | Vé đã lưu khi mất mạng; trang lỗi; bộ prototype giao diện |

---

## 6. API (`/api/<tên>`)

| API | Việc chính |
|---|---|
| `auth` | `register`, `login` (sai 5 lần / 15 phút → khóa), `forgot` / `reset` (OTP 6 số), `me`, `profile`, `password`, `export` (tải dữ liệu), `delete` (xóa tài khoản, ẩn danh đơn), `unsubscribe` |
| `catalog` | Công khai: `movies`, `cinemas`, `cinema`, `showtimes` (`date`, `days` ≤ 31, `cinema`, `movie`), `showtime`, `banners`, `movie_stats`, `posts`, `post`, `pricing`, `price_summary`, `voucher` |
| `create-order` | POST tạo đơn `PENDING`, khóa ghế nguyên tử 10 phút. Bắt buộc đăng nhập; **giá do máy chủ tính** (trình duyệt không sửa được) |
| `order-status` | GET `?code=` trạng thái thời gian thực; mỗi lần hỏi cũng "đẩy" đơn theo lịch Tầng 1 / 2 (cần vì serverless không có tiến trình nền) |
| `order-action` | Chủ đơn: `cancel` (hủy đơn chưa trả tiền, nhả ghế), gửi lại vé qua email |
| `orders` | Lịch sử đơn của khách; người lạ chỉ tra được trạng thái theo `?codes=` |
| `sepay-webhook` | POST từ SePay, header `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`; idempotent theo mã giao dịch ngân hàng |
| `pay` | `methods`, `start`, `ipn`, `return` cho VNPay / MoMo / ZaloPay (chỉ bật khi có khóa) |
| `reconcile` | BetaBot "Hỗ trợ đối soát": ghi nhận báo lỗi, tra cổng ngay, trả lời theo trạng thái |
| `report-issue` | Nút "Đã chuyển tiền nhưng chưa có vé" → phiếu ưu tiên + tra cổng ngay |
| `refund` | Tra cứu hoàn tiền, RefundForm (chỉ mở khi hệ thống không tự hoàn được) |
| `support` | Gửi / xem phiếu hỗ trợ, trả lời phản hồi CSKH |
| `member` | Beta Club `points`, `history`; đánh giá `reviews`, `review_stats`, `can_review`, `review`; `favorite(s)`; `watch` (nhắc mở bán) |
| `events` | Thuê rạp / vé nhóm / Private Show |
| `invoice` | Yêu cầu hóa đơn điện tử |
| `seats` | Ghế đang giữ / đã bán của một suất |
| `movie-page` | Phục vụ `/phim/<mã>` có sẵn thẻ SEO |
| `sitemap` | `sitemap.xml`, `robots.txt` |
| `health` | Sống / chết; `?schema=1` thêm **tự kiểm tra database** (34 bảng, 396 cột) và **chẩn đoán SePay** (khóa, API, webhook gần nhất) – chỉ đúng/sai, không lộ khóa |
| `cron` | Job hằng ngày (header `Bearer <CRON_SECRET>`): đối soát Tầng 2 / 3, thư nhắc, tự gia hạn lịch chiếu, kiểm tra vận hành |
| `simulate-payment` | **Sandbox** mô phỏng ngân hàng (mục 7.5). Tắt trên database thật trừ khi `ALLOW_SANDBOX=1` |
| `admin` | Toàn bộ thao tác nội bộ (khoảng 80 action), mỗi action kiểm tra quyền (mục 8) |

---

## 7. Quy trình thanh toán và đối soát 3 tầng

Logic nằm ở `lib/flow.js`. Mọi hàm **idempotent**: webhook trùng, nhiều tab cùng hỏi trạng thái hay cron chạy chồng không tạo vé trùng hay lệnh hoàn trùng. Đổi trạng thái đơn dùng compare-and-set.

### 7.1 Đơn và mã đơn
- Mã đơn: `BC` + 10 chữ số (ví dụ `BC2610279854`). Khách ghi mã này trong nội dung chuyển khoản.
- Trạng thái đơn: `PENDING` → `CONFIRMED` (đủ tiền trong 10 phút) | `CONFIRMED_LATE` (tiền về muộn, cấp vé bù) | `EXPIRED` | `CANCELLED` | `REFUND_REQUESTED` → `REFUNDED` | `MANUAL_REVIEW` | `FAILED`.
- Ghế: bảng `seat_holds` khóa chính (suất, ghế) → không bao giờ bán trùng (đã kiểm thử 20 khách cùng giành 1 ghế).
- Sổ cái tiền vào: `bank_transactions` (webhook SePay, API tra cứu SePay, cổng ví đều ghi vào đây).

### 7.2 Ba tầng (hằng số trong `CONFIG`)
| Tầng | Khi nào | Làm gì |
|---|---|---|
| **1** | Trong 10 phút giữ ghế (`HOLD_MS`) | Chờ webhook 2 phút → Short Polling 15 giây/lần × 4 → Final Check 3 phút/lần → tra cứu chốt lúc hết 10 phút. Đủ tiền → xuất vé; thiếu → trang chuyển bù; thừa → xuất vé + hoàn phần thừa |
| **2** | Sau khi hết giờ, cửa sổ 24 giờ (`SCAN_WINDOW_MS`) | Job 30 phút/lần quét đơn `EXPIRED`: tiền về muộn mà ghế còn → cấp vé bù (`CONFIRMED_LATE`); ghế đã bán (`SEAT_TAKEN`), còn < 30 phút trước giờ chiếu (`NEAR_SHOWTIME`) hoặc chuyển sau khi hết giờ (`LATE`) → hoàn tiền |
| **3** | Hoàn tiền | Lệnh hoàn có `idempotency_key`, gửi lại mỗi chu kỳ trong 24 giờ; quá hạn → `MANUAL_REVIEW` + RefundForm + phiếu CSKH → CSKH đối chiếu → Kế toán duyệt chi (nguyên tắc 2 người) |

- **Ai "đẩy" quy trình chạy:** ở máy, `server.js` tự chạy Job định kỳ. Trên Vercel không có tiến trình nền và gói Hobby chỉ cho cron **1 lần/ngày**, nên đơn còn được đẩy mỗi khi có người mở trạng thái đơn (`/api/order-status`, trang thanh toán hỏi liên tục), khi webhook về, và khi nhân viên mở đơn trong admin.
- Lý do hoàn: `LATE`, `SEAT_TAKEN`, `NEAR_SHOWTIME`, `SHORT`, `EXCESS`, `DUPLICATE`, `MISMATCH`.
- Trạng thái hồ sơ hoàn: `REQUESTED` → `RETRYING` → `DONE` | `MANUAL_REVIEW` → `FORM_SUBMITTED` → `CS_APPROVED` → `PAID_OUT` (Kế toán có thể trả về: `ACC_RETURNED`).
- **Lưu ý:** VietQR là chuyển khoản một chiều nên "Refund API" là **mô phỏng**. Hệ thống tính đúng số tiền, lập hồ sơ, giữ tài khoản nguồn của khách; tiền thật do Kế toán chuyển trả rồi bấm "Đã chi".

### 7.3 Webhook SePay và đường dự phòng
- Webhook: SePay → `/api/sepay-webhook`, kiểu chứng thực **API Key** (giá trị = `SEPAY_WEBHOOK_KEY`). Không có khóa → 401 (trên DB thật mà chưa đặt khóa → 503).
- Chỉ ghép tiền vào đơn khi nội dung chứa đúng mã `BC…` (đọc được cả khi ngân hàng viết dính chữ). Tiền không khớp đơn nào → mục "Tiền vào không khớp đơn" cho CSKH, **không** tự ghép vào đơn gần nhất.
- Đường dự phòng: mỗi lần tra cứu, máy chủ gọi API SePay (`SEPAY_API_KEY`) lấy 100 giao dịch gần nhất, **khớp theo mã đơn** (không lọc theo số tài khoản vì tài khoản ảo MSB được ghi dưới số tài khoản chính).
- Cấu hình SePay đang dùng: webhook trỏ `https://ptnvnhom3betacinemas.vercel.app/api/sepay-webhook`, JSON, tự gửi lại khi lỗi, **Bảo mật: API Key**. Không cần cài "nhận diện mã thanh toán" bên SePay.
- Kiểm tra nhanh: `/api/health?schema=1` → `payments.ok`, `last_webhook` (thời điểm + `MATCHED`), `last_rejected`.

### 7.4 Vé và soát vé
- Mã vạch Code 128: `BC<10 số mã đơn><8 số chữ ký HMAC>` (khóa từ `AUTH_SECRET`). Sửa 1 chữ số → "vé có thể bị làm giả".
- QR cũ `BETA1.<mã đơn>.<chữ ký 16 ký tự>` vẫn được nhận (vé đã lưu trước đây).
- Quầy (admin → Quầy): camera đọc `code_128` + `qr_code` (Chrome Android / macOS), máy quét USB gõ thẳng vào ô, hoặc gõ mã đơn (ghi là nhập tay). Mỗi vé soát **một lần**; chỉ mở soát **từ 2 giờ trước đến 3 giờ sau** giờ chiếu. Phiếu bắp nước dùng trong 30 ngày.
- Quầy chọn **rạp làm việc**: vé của rạp khác bị chặn ("VÉ CỦA RẠP KHÁC") **trước khi** ghi nhận nên vé không bị "đốt"; nhân viên có thể bấm "Vẫn cho vào" (ghi vào nhật ký thao tác). Kết quả hiện 5 trạng thái màu + âm báo + rung: hợp lệ / đã soát / rạp khác / chưa tới giờ / không hợp lệ. Camera không gửi lại cùng mã trong 20 giây, cùng một mã đang kiểm tra thì không gửi trùng; "Chế độ quầy" ẩn menu, toàn màn hình, giữ màn hình sáng.

### 7.5 Sandbox (diễn tình huống không cần tiền thật)
`/api/simulate-payment` – chỉ chạy ở bộ nhớ trong (`DB_MODE=mock`) hoặc khi `ALLOW_SANDBOX=1`. Bảng nút nằm cuối `gateway.html` ("Chế độ kiểm thử – Sandbox dành cho Hội đồng chấm điểm") và `underpay.html`.

| Kịch bản | Ý nghĩa |
|---|---|
| `OK` (TC-01) | Chuyển đủ, webhook về ngay |
| `NETWORK_LAG` (TC-03) | Đã trừ tiền nhưng webhook thất lạc → Short Polling bắt |
| `SLOW_BANK` (TC-04/05/06) | Ngân hàng xử lý chậm, cổng báo PENDING |
| `SHORT` / `TOPUP` | Chuyển thiếu / chuyển bù nốt |
| `EXCESS` | Chuyển thừa → xuất vé + tự hoàn phần thừa |
| `LATE` (TC-08) | Chuyển sau khi hết 10 phút |
| `SEAT_TAKEN` (TC-07) | Khách khác mua mất ghế của đơn đã hết hạn |
| `MISMATCH`, `DUP_WEBHOOK` (TC-15) | Sai số tiền; webhook gửi lại |
| `UNMATCHED` | Tiền vào không ghi mã đơn |
| `REFUND_FAIL` (TC-09/10), `NO_SOURCE` | Lệnh hoàn thất bại; không truy được tài khoản nguồn |
| `SHOWTIME`, `SHIFT` | Đặt giờ chiếu gần; "tua nhanh" thời gian của đơn |

---

## 8. Tài khoản và phân quyền

- **Khách (Beta Club):** đăng ký bằng email / SĐT, mật khẩu băm scrypt, phiên là token ký HMAC (`AUTH_SECRET`, đổi khóa = đăng xuất mọi người). Đặt vé bắt buộc đăng nhập.
- **Ai xem được gì của đơn (`lib/access.js`):** chủ đơn và nhân viên xem đầy đủ (kể cả mã vạch); người chỉ biết mã đơn chỉ thấy **trạng thái** (không tên, SĐT, email, mã vạch, lịch sử, tài khoản nhận hoàn).
- **Nhân viên (`lib/staff.js`):** tài khoản riêng, phiên 12 giờ, nhật ký mọi thao tác ghi (`audit_logs`), đăng nhập 2 lớp TOTP (bắt buộc nếu `STAFF_REQUIRE_2FA=1`).

| Vai trò | Quyền |
|---|---|
| `MANAGER` – Quản lý | Toàn quyền: danh mục, nhân sự, nhật ký, công cụ IT, mở lại sổ đã chốt |
| `ACCOUNTANT` – Kế toán | `order.view`, `refund.view`, `refund.pay` (duyệt chi, bảng kê, chốt sổ, hóa đơn), `refund.return`, `report.view` |
| `CS` – CSKH | `order.view`, `refund.view/decide/send/remind/confirm`, `ticket.view`, `ticket.resolve` (phiếu, khách 360°, đánh giá, thuê rạp) |
| `COUNTER` – Quầy | `order.view`, `ticket.checkin` |

- Tài khoản Quản lý đầu tiên: tạo một lần bằng `ADMIN_KEY` trên `admin.html` (đã tạo trên web thật; `ADMIN_KEY` giờ không còn tác dụng).
- Chế độ bộ nhớ trong tự tạo 4 tài khoản demo `quanly@ / ketoan@ / cskh@ / quay@beta.local` (mật khẩu demo trong `lib/staff.js`, hàm `seedDemo`). **Không** tạo trên database thật.

---

## 9. Giá vé, Beta Club, voucher

- **Giá do máy chủ tính** từ `catalog.js` + bảng giá trong database; trình duyệt không sửa được số tiền.
- Giá mặc định ghế: thường 45.000 đ, VIP 50.000 đ, ghế đôi (sweetbox) 100.000 đ.
- Quy tắc giá theo thứ / ngày lễ / khung giờ (`price_rules`, ưu tiên cao áp sau). Mẫu: T2–T5 45k / 50k / 100k; T6–CN 55k / 60k / 120k; ngày lễ 65k / 70k / 140k; suất sớm trước 10:00 40k / 45k / 90k. Mỗi suất có thể đặt **giá riêng**.
- Loại vé theo đối tượng (HSSV / U22, trẻ em, người cao tuổi) giảm thẳng vào giá ghế (không áp ghế đôi); quầy được nhắc kiểm tra giấy tờ.
- Combo bắp nước (ví dụ Combo Solo 69.000 đ) trong `catalog.js`.
- **Beta Club:** hạng Thành viên (5% vé, 3% bắp nước), VIP từ 2 triệu chi tiêu / 365 ngày (7% / 4%), VVIP từ 4 triệu (10% / 5%). 1 điểm = 1.000 đ, dùng tối đa 50% đơn, hết hạn sau 12 tháng, quà sinh nhật 50 điểm. Sổ điểm chỉ ghi thêm, có `ref` duy nhất.
- Voucher: giới hạn tổng lượt, lượt mỗi khách, thời hạn, điều kiện (đơn tối thiểu, kèm combo, theo thứ, giảm %).

---

## 10. Database

34 bảng, định nghĩa đầy đủ trong `schema.sql`:

| Nhóm | Bảng |
|---|---|
| Đơn & tiền | `orders`, `seat_holds`, `bank_transactions`, `refunds`, `gateway_logs`, `payment_attempts` |
| Khách | `customers`, `password_resets`, `auth_throttle`, `point_ledger`, `movie_reviews`, `favorites`, `movie_watches` |
| Danh mục | `movies`, `cinemas`, `rooms`, `showtimes`, `vouchers`, `ticket_types`, `price_rules`, `holidays`, `posts`, `banners` |
| Vận hành nội bộ | `staff`, `audit_logs`, `support_tickets`, `notifications`, `ticket_checkins`, `day_closings`, `invoice_requests`, `event_requests`, `campaigns` |
| Hệ thống | `error_logs`, `system_state` |

Storage: kho ảnh công khai `media` (poster, banner, ảnh rạp tải lên từ admin; JPG / PNG / WebP ≤ 2,5 MB, kiểm tra "chữ ký" đầu tệp).

**Migration** (chạy trong Supabase → SQL Editor, theo thứ tự; file nào cũng chạy lại an toàn):
1. `2026-11-18_quy-trinh-3-tang.sql` – phiếu hỗ trợ, thông báo, nhật ký cổng
2. `2026-11-19_thanh-vien.sql` – khách hàng
3. `2026-11-20_ke-toan-tra-ve.sql` – nhân viên, nhật ký thao tác
4. `2026-11-21_danh-muc-qr-otp.sql` – phim, rạp, suất, voucher (kèm dữ liệu khởi tạo), soát vé, OTP
5. `2026-11-22_dot-1-gia-ve-tin-tuc.sql` – loại vé, quy tắc giá, ngày lễ, tin tức, tọa độ rạp
6. `2026-11-23_voucher-dieu-kien-phan-hoi-phieu.sql`
7. → 14. `2026-11-24` … `2026-12-01` (Đợt 2 → Đợt 10)

- `migrations/GOP-dot-2-den-dot-10.sql`: gộp sẵn 7 → 14, không có lệnh xóa, cuối file in bảng **"Đã có"** để tự kiểm tra.
- `migrations/DU-LIEU-lich-chieu-va-dia-chi-rap.sql`: dữ liệu mẫu – địa chỉ 9 rạp + lịch 14 ngày cho rạp chưa có suất (chạy lại an toàn).
- Database mới: chạy `schema.sql`. Sau khi sửa `schema.sql` phải chạy `node tools/gen-schema-columns.js` (kiểm thử báo lỗi nếu quên).
- Web thật hiện **đủ 34 bảng / 396 cột** (kiểm tra bằng `/api/health?schema=1`).

---

## 11. Biến môi trường (Vercel → Settings → Environment Variables)

Chỉ ghi tên. Giá trị nằm trên Vercel, **không bao giờ** đưa vào mã nguồn hay tài liệu.

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | ✔ | Khóa secret / service_role, chỉ dùng phía máy chủ (khóa publishable / anon bị từ chối) |
| `AUTH_SECRET` | ✔ | ≥ 32 ký tự ngẫu nhiên; ký phiên đăng nhập và chữ ký vé |
| `SEPAY_WEBHOOK_KEY` | ✔ | Trùng API Key trong cấu hình webhook SePay |
| `SEPAY_API_KEY` | ✔ | Token API SePay (đường dự phòng + chẩn đoán) |
| `SEPAY_ACCOUNT_NUMBER` | nên đặt | Tài khoản nhận tiền (MSB, tài khoản ảo); chẩn đoán dùng để đối chiếu với giao dịch thật |
| `SEPAY_BANK_CODE` | tùy chọn | Tên ngân hàng, chỉ hiện trong chẩn đoán |
| `CRON_SECRET` | ✔ | Bảo vệ `/api/cron` |
| `SITE_URL` | không cần trên Vercel | Trên Vercel link trong email / IPN tự theo tên miền production (`lib/site-url.js`); chỉ dùng khi chạy ngoài Vercel |
| `ADMIN_KEY` | một lần | Tạo Quản lý đầu tiên; đã dùng xong, có thể xóa |
| `RESEND_API_KEY`, `MAIL_FROM` | tùy chọn | Gửi email thật |
| `STAFF_REQUIRE_2FA`, `ALERT_EMAILS` | tùy chọn | Bắt buộc 2 lớp cho nhân viên; email nhận cảnh báo |
| `AUTO_SCHEDULE_DAYS` | tùy chọn | Số ngày lịch chiếu cron giữ sẵn (mặc định 14, `0` = tắt) |
| `MIN_REVIEWS_SHOW`, `INVOICE_REQUEST_HOURS`, `MEDIA_BUCKET` | tùy chọn | Ngưỡng hiện ★ (3); hạn yêu cầu hóa đơn (24 giờ); tên kho ảnh (`media`) |
| `EINVOICE_PROVIDER` | tùy chọn | Nhà cung cấp hóa đơn điện tử (mặc định: Kế toán xuất CSV và nhập số hóa đơn tay) |
| `VNPAY_*`, `MOMO_*`, `ZALOPAY_*` | tùy chọn | Bật cổng ví / thẻ (cần hợp đồng merchant; chưa có) |
| `ALLOW_SANDBOX` | **không** đặt trên production | Mở sandbox thanh toán |
| `DB_MODE`, `REQUIRE_DB`, `PORT` | chạy ở máy | `DB_MODE=mock` = bộ nhớ trong |

---

## 12. Chạy ở máy và kiểm thử

```powershell
# Bản thử (bộ nhớ trong, có sẵn phim / rạp / lịch 14 ngày / 4 nhân viên demo, có bảng Sandbox)
$env:DB_MODE="mock"; $env:PORT="3000"; npm start      # mở http://localhost:3000
```

| Lệnh | Kiểm tra |
|---|---|
| `npm test` | 73 kiểm thử nghiệp vụ (3 tầng, phân quyền, giá, ghế, Beta Club, cổng ví, Supabase giả 1.000 dòng…) |
| `npm run test:e2e` | 11 bước trên trình duyệt thật: đăng ký → phim → ghế → combo → VietQR (sandbox) → vé mã vạch → quầy soát → điện thoại / mua vé nhanh / admin. `E2E_SHOTS=<thư mục>` để chụp màn hình |
| `npm run test:pages` | 33 trang × 2 cỡ màn hình: lỗi JS, tràn ngang, CSP. `PAGE_LANG=en` cho tiếng Anh; `PAGE_BASE=https://…` chạy thẳng trên web thật (chỉ xem) |
| `npm run test:a11y -- --all` | Trợ năng (axe-core) 18 trang |
| `node tools/i18n-extract.js <url> en` | Liệt kê câu chưa dịch (chỉ chạy ở máy) |
| `npm run backup` | Sao lưu dữ liệu |

---

## 13. Triển khai và vận hành

- **Quy trình:** sửa trên nhánh làm việc → `npm test` (+ e2e / pages khi đụng giao diện) → commit → `git fetch` + kiểm tra `origin/main` là tổ tiên → **đẩy thẳng** lên `feat/dot-1-nang-cap`, `feat/quy-trinh-doi-soat-3-tang` và `main` (không dùng pull request) → Vercel tự deploy (~30–60 giây).
- **Sau mỗi lần đẩy `main`:** kiểm tra web thật ngay; lỗi thì sửa và đẩy lại.
- **Đợt có migration:** chờ người dùng chạy migration trên Supabase rồi mới đẩy `main` (trừ bản sửa lỗi deploy).
- **Kiểm tra nhanh web thật:**
  - `/api/health` → `"mode":"live"`
  - `/api/health?schema=1` → `schema.ok` và `payments.ok` đều `true`
  - `/api/admin?action=status` → `live_db: true`, `needs_bootstrap: false`
- **Cron hằng ngày (08:00 VN):** đối soát Tầng 2 / 3, thư nhắc, Beta Club, **tự gia hạn lịch chiếu**, kiểm tra hồ sơ hoàn thủ công quá 24 giờ.
- **Admin → IT / Dev:** tình trạng hệ thống, lần chạy cron / webhook gần nhất, log lỗi; cảnh báo email khi lỗi dồn dập hoặc webhook bị từ chối liên tục.
- Hiệu năng đo trên web thật (sau khi chuyển hàm về `sin1`): lịch 7 ngày ~0,8 s, trang Giá vé ~2 s, trang chủ ~1,8 s (desktop).

---

## 14. Lịch sử phát triển

| Giai đoạn | Nội dung |
|---|---|
| Prototype | Giao diện mô phỏng, trang hoàn tiền, đơn hủy / hoàn |
| Giai đoạn 1–6 | Quy trình 3 tầng thật; đăng nhập thành viên; giá / combo / voucher dùng chung, máy chủ tự tính tiền; hóa đơn, vé, chatbot dùng dữ liệu thật; email Resend, phiếu hỗ trợ; nhân viên + phân quyền + nhật ký; danh mục trong database, soát vé, OTP, tổng quan doanh thu |
| Đợt 1 | Loại vé theo đối tượng, giá theo ngày / khung giờ, tin tức & ưu đãi, gom API thành 1 function, icon SVG thay emoji |
| Đợt 2 | Beta Club, đánh giá phim, PWA, mua bắp nước riêng, thư nhắc |
| Đợt 3 | Phòng chiếu có sơ đồ ghế, thuê rạp / vé nhóm, báo cáo Quản lý, nhắc mở bán, SEO |
| Đợt 4 | Khung cổng VNPay / MoMo / ZaloPay, hóa đơn điện tử, song ngữ |
| Đợt 5 | Vận hành & an toàn (log lỗi, cảnh báo, health, sao lưu, chặn spam), `/phim/<mã>`, phim yêu thích |
| Đợt 6 | Dữ liệu cá nhân (đồng ý điều khoản, tải / xóa dữ liệu), 2FA nhân viên, sao chép lịch, email ưu đãi, kiểm thử e2e |
| Đợt 7 | Nâng cấp công cụ Kế toán (bảng kê, chốt sổ), CSKH (nhận phiếu, khách 360°), Quầy |
| Đợt 8 + 9 | Giao diện điện thoại (menu ☰), tìm phim / rạp không dấu, mua vé nhanh 4 bước, trang Rạp, xếp hạng bán chạy, điểm ★ |
| Đợt 10 | Chốt an toàn database, banner & tải ảnh trong admin, thẻ phim theo admin, sửa lỗi giao diện; nối Supabase thật, file migration gộp, tự kiểm tra database, chuyển hàm về Singapore, tạo suất hàng loạt nhanh, đọc Supabase quá 1.000 dòng, lịch mẫu + cron tự gia hạn, chẩn đoán SePay, đường dự phòng SePay không lọc tài khoản |
| Đợt 11 (đầu) | Vé dùng **mã vạch Code 128** thay QR; dải chọn ngày đặt vé gọn 7 ngày |
| Đợt 11 (admin) | Làm lại giao diện `admin.html` sau khi khảo sát các trang quản trị cùng loại: menu trái theo nhóm (điện thoại: menu trượt), đường dẫn chia sẻ được `admin.html#ketoan`, `#danhmuc/lich-chieu`; hộp thoại + thông báo trong trang thay `alert/confirm/prompt`; ngăn kéo chi tiết có "Quay lại". Quầy: 5 trạng thái, chặn vé rạp khác, chế độ quầy. Tổng quan: ô "việc cần xử lý", chọn nhanh kỳ, so với kỳ trước, doanh thu thuần chỉ trừ tiền hoàn do hủy / sự cố. Kế toán: nhắc nguyên tắc 2 người, giữ mã GD đang gõ, gom ngày không phát sinh. Danh mục chia 6 mục con + thanh "Đang sửa". IT: đèn trạng thái từ `/api/health`. Nhân sự: cột bảo mật 2 lớp, lọc nhật ký |

---

## 15. Tình trạng hiện tại và việc còn lại

**Đã chạy trên web thật:** đặt vé, thanh toán SePay tiền thật (webhook `MATCHED`), vé mã vạch, quầy soát, lịch 14 ngày 9 rạp (2.151 suất), địa chỉ rạp, tài khoản Quản lý. 33 trang × 2 cỡ màn hình không lỗi.

**Việc dọn dẹp nhỏ (chưa làm):**
- Xóa / ngắt project Vercel cũ `ptnvnhom3.vercel.app`.
- Đổi khóa Supabase secret (đã từng lộ trong chat) và cập nhật Vercel.
- Xóa `ADMIN_KEY` (không gấp).
- Rạp chưa có hotline, ảnh, tiện ích; chưa có phòng chiếu riêng; chưa có banner riêng (đang dùng ảnh mặc định).

**Giới hạn đã biết:**
- Hoàn tiền là mô phỏng (Kế toán chuyển tay).
- VNPay / MoMo / ZaloPay chỉ là khung, chưa có khóa merchant.
- Email chỉ gửi thật khi có `RESEND_API_KEY`.
- Số tài khoản QR ghi cứng trong 2 trang (đổi tài khoản phải sửa code).
- Thông tin phim trong mỗi suất chiếu được trả kèm đầy đủ (payload lớn khi lấy lịch nhiều rạp – trang Giá vé đã chuyển sang `price_summary`).

**Kế hoạch tiếp (theo định vị "rẻ nhất, nhanh nhất, không mất tiền oan"):**
- **Đợt 11 – rẻ & nhanh:** đặt vé không cần tài khoản, ưu đãi chỉ có trên web, đặt lại 1 chạm, đo phễu chuyển đổi. Chờ chốt 3 chính sách: (1) có cho đặt không cần tài khoản? (2) mức ưu đãi riêng web? (3) có cho hủy vé đổi điểm (ví dụ trước 2 giờ, hoàn 100% bằng điểm)?
- **Đợt 12 – an tâm:** hiện cam kết hoàn tiền, nút chat Zalo, trang theo dõi hoàn tiền rõ hơn, bật ví khi có hợp đồng.
- **Đợt 13 – nội dung:** Góc điện ảnh (bài bình luận phim), popup khuyến mãi, SEO, dịch nốt tiếng Anh.

**So với đối thủ (khảo sát 21/11/2026 – Beta, CGV, Galaxy, Lotte, CineStar, BHD):** mình hơn ở đối soát / hoàn tiền tự động, giờ kết thúc + ghế trống trên suất, chọn giúp ghế, vé offline, song ngữ, công cụ nội bộ, tốc độ (trang chủ ~1,8 s so với Beta 6,0 s, CGV 4,0 s, Galaxy 3,8 s). Còn thiếu: Góc điện ảnh, chat Zalo / Messenger, eGift, ví điện tử.

---

## 16. Quy ước làm việc

- Trả lời và viết giao diện **bằng tiếng Việt**; chữ trên web viết cho khách hiểu (tránh thuật ngữ kỹ thuật).
- **Đẩy thẳng lên GitHub, không dùng pull request.** Người dùng tự quản lý Vercel; máy làm việc không có `gh`.
- Sau khi đẩy `main` phải kiểm tra web thật ngay; hỏng thì chẩn đoán, sửa, đẩy lại.
- Trên web thật chỉ dùng GET để kiểm tra; **không** tạo đơn, không đăng nhập bằng mật khẩu thay người dùng.
- Không bao giờ đưa khóa bí mật vào mã nguồn, commit hay tài liệu.
- Commit message tiếng Việt, mô tả lý do; kết thúc bằng dòng `Co-Authored-By` theo quy ước của trợ lý.
- Mỗi tính năng có kiểm thử trong `tools/smoke-test.js` (và e2e khi đụng luồng giao diện); chạy `npm test` trước khi đẩy.
