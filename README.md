# Beta Cinemas – Đặt vé & thanh toán VietQR

## Chạy thử

```bash
npm install
npm start          # http://localhost:3000
```

Không có `.env` thì server tự dùng bộ nhớ tạm (Mock Store), mọi luồng vẫn chạy được.

Tài khoản demo: `luonghonganh@betacinemas.vn` / `12345678` (hoặc tự đăng ký tài khoản mới ở `/auth`).
Tài khoản và đơn hàng hiện lưu trên trình duyệt (localStorage) — sẽ chuyển sang database sau.

## Cấu trúc thư mục

```
api/                 API serverless (Vercel) – mỗi file là một endpoint /api/<tên-file>
lib/db.js            Tầng dữ liệu (Supabase hoặc Mock Store)
lib/pricing.js       Server tự tính tiền vé + combo
public/              Toàn bộ giao diện tĩnh
  *.html             Các trang
  css/prototype-theme.css   CSS dùng chung
  js/store.js        Lớp lưu trữ duy nhất (localStorage) + bảng ánh xạ khóa -> bảng database
  js/layout.js       Header, footer, quick-dock, phiên đăng nhập, khả năng truy cập
  js/accounts.js     Tài khoản: đăng ký, đăng nhập, quên / đổi mật khẩu
  js/showtimes.js    Suất chiếu và trạng thái ghế theo phim / rạp / ngày
  js/pay-client.js   Gọi API, lưu đơn trên trình duyệt, danh mục phim & combo,
                     đơn mẫu (DEMO_INVOICES), Pay.getOrderView(), Pay.buildInvoice()
  images/
    posters/<mã-phim>.jpg   Poster phim (tên file = mã phim, ví dụ an-mang-karaoke.jpg)
    banners/                Banner trang chủ
    promos/                 Ảnh khuyến mãi
    ui/                     Logo, icon, nhãn độ tuổi
server.js            Server chạy local (phục vụ public/ + api/)
schema.sql           Cấu trúc bảng Supabase
```

## Thêm trang mới

```html
<head>
  <link rel="stylesheet" href="css/prototype-theme.css">
  <script src="js/layout.js"></script>
</head>
<body>
  <script>Layout.header()</script>
  ... nội dung ...
  <script>Layout.footer()</script>
  <script src="js/pay-client.js"></script>  <!-- nếu trang cần dữ liệu phim/đơn -->
</body>
```

Sửa menu, footer hay danh sách rạp chỉ cần sửa trong `public/js/layout.js`.

## Thêm phim mới

1. Thêm poster vào `public/images/posters/<mã-phim>.jpg`
2. Khai báo phim trong `Pay.MOVIES` (`public/js/pay-client.js`)

## Hàm dùng chung hay dùng

| Hàm | Dùng để |
|---|---|
| `Layout.getUser()` / `Layout.requireLogin()` | Lấy người đang đăng nhập / bắt buộc đăng nhập ở trang |
| `Pay.getMovieDetail(mã)` | Thông tin đầy đủ một phim (trang chi tiết phim) |
| `Pay.getOrderView(mã)` | Thông tin đơn đã chuẩn hóa cho các trang chi tiết đơn |
| `Pay.buildInvoice(đơn)` | Dữ liệu hóa đơn điện tử từ một đơn hàng |
| `Pay.comboText(combos)` | `{"couple":1}` → `Combo Couple × 1` |

## Kiểm thử tự động

```bash
npm test
```

Chạy server ở chế độ bộ nhớ tạm (`MOCK_DB=1`) rồi dùng Playwright đi qua các luồng chính: mọi trang mở không lỗi,
không tràn ngang trên điện thoại, đặt vé từ đầu đến cuối, đăng nhập / đăng ký, các trang chi tiết đơn và API.
Lần đầu chạy trên máy mới cần cài trình duyệt: `npx playwright install chromium`.
GitHub Actions tự chạy bộ kiểm thử mỗi lần push lên `main` (`.github/workflows/test.yml`).

## Tài khoản demo

| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Khách hàng | `luonghonganh@betacinemas.vn` | `12345678` |
| Quản trị (`/admin`) | `admin@betacinemas.vn` | `admin12345` |

## Biến môi trường (xem `.env.example`)

| Biến | Ý nghĩa |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Kết nối database. Không đặt → Mock Store (dữ liệu tạm trong bộ nhớ) |
| `SEPAY_API_KEY` | API Key của webhook SePay; server từ chối webhook thiếu / sai header `Authorization: Apikey <key>` |
| `ALLOW_SIMULATE=1` | Bật sandbox giả lập thanh toán khi chạy production (mặc định tắt khi `NODE_ENV=production`) |
| `MOCK_DB=1` | Luôn dùng Mock Store (dùng khi chạy kiểm thử) |

## Bảo mật phía server

- Không còn key viết cứng trong mã nguồn; chỉ đọc từ biến môi trường.
- Webhook SePay: kiểm tra API key, chỉ xử lý tiền vào, không tự ghép giao dịch thiếu mã vào đơn khác
  và không tự tạo đơn — các giao dịch đó lưu `UNMATCHED` để đối soát.
- `/api/create-order`: server tự tính tiền từ ghế + combo (`lib/pricing.js`), chỉ chấp nhận giảm giá tối đa 50%.
- `/api/orders`: bắt buộc lọc theo số điện thoại, không trả toàn bộ đơn của mọi khách.

Còn lại khi nối database: tài khoản / phiên đăng nhập / quyền quản trị hiện kiểm tra ở trình duyệt
(localStorage) — cần chuyển sang Supabase Auth + kiểm tra quyền ở server. `schema.sql` đã có sẵn các bảng
`profiles`, `showtimes`, `vouchers`, `voucher_usages`, `support_tickets`, `ticket_replies`.
