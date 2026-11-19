# Beta Cinemas — Đặt vé & Thanh toán VietQR

Đồ án nhóm 3 (PTNV). Website đặt vé xem phim với thanh toán chuyển khoản VietQR, nhận biến động
qua webhook SePay, tự xử lý trả thiếu / trả thừa / trả trễ / trễ webhook, hoàn tiền và đối soát
qua trợ lý BetaBot.

- Frontend: HTML/CSS/JS tĩnh ở thư mục gốc (không cần build).
- Backend: các hàm kiểu Vercel trong `api/`, tầng dữ liệu `lib/db.js` (Supabase, dự phòng Mock Store).
- Tài liệu đặc tả (Spec Kit): `.specify/memory/constitution.md`, `specs/001-vietqr-payment-baseline/`.

## Chạy local

```bash
npm install
npm start          # http://localhost:3000 — chưa cấu hình Supabase thì dùng Mock Store trong RAM
```

## Biến môi trường

Sao chép `.env.example` thành `.env` rồi điền giá trị thật. **Không commit `.env`.**

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `SUPABASE_URL` | production | URL dự án Supabase |
| `SUPABASE_SECRET_KEY` | production | Khóa server (service role) — các bảng bật RLS nên chỉ khóa này đọc/ghi được |
| `SEPAY_API_KEY` | production | API key webhook SePay; webhook kiểm tra header `Authorization: Apikey <key>` |
| `SEPAY_ACCOUNT_NUMBER`, `SEPAY_BANK_CODE` | | Tài khoản nhận tiền |
| `NODE_ENV=production` | | Bật chế độ nghiêm ngặt: lỗi CSDL được báo ra, tắt simulator, bắt buộc `SEPAY_API_KEY` |
| `ENABLE_SIMULATOR=true` | | Bật `/api/simulate-payment` ở production (chỉ cho bản demo) |
| `ALLOW_MOCK_DB=true` | | Cho phép Mock Store ở production khi chưa có Supabase (chỉ cho bản demo) |

Trên Vercel, khai báo các biến này ở Project Settings → Environment Variables.

## Cơ sở dữ liệu

Supabase → SQL Editor → chạy toàn bộ `schema.sql`.

## Kiểm thử

```bash
npm test
```

Bộ test (`tests/`, dùng `node:test`, không cần mạng) phủ các tình huống: đủ, thiếu, bù, thừa, trễ,
trùng giao dịch, sai API key, không khớp mã đơn, đối soát BetaBot, hoàn tiền, khóa ghế, bảo vệ file tĩnh.

## Demo các tình huống thanh toán

```bash
curl -s -X POST localhost:3000/api/simulate-payment -H 'Content-Type: application/json' -d '{"scenario":"SHORT"}'
```

`scenario`: `OK`, `SHORT`, `EXCESS`, `LATE`, `NETWORK_LAG` (sau đó đối soát mã GD trong BetaBot).

## Quy trình phát triển (Spec Kit)

`/speckit-specify <mô tả>` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-analyze` → `/speckit-implement`. Mọi thay đổi phải tuân theo constitution.
