# Quickstart: Baseline thanh toán VietQR

## Chạy local (Mock Store, không cần Supabase)

```bash
npm install
npm start            # http://localhost:3000
```

## Chạy với Supabase

1. Supabase → SQL Editor → chạy `schema.sql`.
2. `cp .env.example .env`, điền `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SEPAY_API_KEY`, ...
3. `npm start`.

## Kiểm tra nhanh các tình huống

```bash
curl -s -X POST localhost:3000/api/simulate-payment -H 'Content-Type: application/json' -d '{"scenario":"OK"}'
curl -s -X POST localhost:3000/api/simulate-payment -H 'Content-Type: application/json' -d '{"scenario":"SHORT"}'
curl -s -X POST localhost:3000/api/simulate-payment -H 'Content-Type: application/json' -d '{"scenario":"EXCESS"}'
curl -s -X POST localhost:3000/api/simulate-payment -H 'Content-Type: application/json' -d '{"scenario":"LATE"}'
curl -s 'localhost:3000/api/order-status?code=BC2610279854'
```

## Kiểm thử tự động (sau khi hoàn thành tasks Phase 2)

```bash
npm test
```

## Quy trình Spec Kit cho tính năng tiếp theo

`/speckit-specify <mô tả>` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks`
→ `/speckit-analyze` → `/speckit-implement`
