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
public/              Toàn bộ giao diện tĩnh
  *.html             Các trang
  css/prototype-theme.css   CSS dùng chung
  js/layout.js       Header, footer, quick-dock dùng chung cho mọi trang
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
