-- =====================================================================
-- Beta Cinemas - schema đặt vé, đối soát & hoàn tiền (Supabase / Postgres)
-- Quy trình 3 tầng "Cứu vé trước – Hoàn tiền sau".
-- Cài mới: dán toàn bộ file vào Supabase > SQL Editor > Run.
-- Nâng cấp DB đang chạy bản cũ: chạy migrations/2026-11-18_quy-trinh-3-tang.sql
-- =====================================================================
create extension if not exists pgcrypto;

-- 0) Thành viên Beta Club (email/SĐT + mật khẩu băm scrypt, xem lib/auth.js)
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  phone         text unique,
  full_name     text not null,
  birthday      date,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- 1) Đơn đặt vé ---------------------------------------------------------
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,               -- BC2610289854: cũng là nội dung chuyển khoản
  user_id         uuid references customers(id),
  phone           text,
  email           text,
  customer_name   text,
  movie_key       text,
  cinema          text,
  show_date       text,
  show_time       text,
  show_at         timestamptz,                        -- giờ chiếu (BR-03: còn >= 30 phút mới cấp vé bù)
  showtime_key    text not null,
  seats           jsonb not null default '[]',
  combos          jsonb not null default '{}',
  voucher         text,
  total           bigint not null check (total >= 0),
  paid_amount     bigint not null default 0,
  status          text not null default 'PENDING' check (status in (
                    'PENDING','CONFIRMED','CANCELLED','FAILED','EXPIRED',
                    'CONFIRMED_LATE','REFUND_REQUESTED','REFUNDED','MANUAL_REVIEW')),
  hold_expires_at timestamptz not null,               -- hết 10 phút giữ ghế
  check_seq       int not null default 0,             -- số mốc tra cứu Tầng 1 đã chạy
  last_check_at   timestamptz,
  reported_at     timestamptz,                        -- khách bấm "Đã chuyển tiền nhưng chưa có vé"
  expired_at      timestamptz,
  scan_until      timestamptz,                        -- hết cửa sổ ScanList 24 giờ
  job_checked_at  timestamptz,                        -- lần Job 30 phút gần nhất
  paid_at         timestamptz,                        -- thời điểm giao dịch ngân hàng
  confirmed_at    timestamptz,
  manual_reason   text,
  source_account  jsonb,                              -- tài khoản nguồn truy xuất từ giao dịch
  sandbox         jsonb,                              -- cờ mô phỏng (chỉ dùng cho demo/UAT)
  history         jsonb not null default '[]',        -- lịch sử chuyển trạng thái (NFR-13)
  created_at      timestamptz not null default now()
);
create index if not exists orders_status_idx on orders(status);
create index if not exists orders_user_idx on orders(user_id);

-- 2) Ghế đang giữ / đã bán: khóa chính (suất, ghế) bảo đảm 0 trùng ghế (NFR-05)
create table if not exists seat_holds (
  showtime_key text not null,
  seat_id      text not null,
  order_id     uuid not null references orders(id) on delete cascade,
  status       text not null default 'HELD' check (status in ('HELD','SOLD')),
  expires_at   timestamptz,
  primary key (showtime_key, seat_id)
);
create index if not exists seat_holds_order_idx on seat_holds(order_id);

-- 3) Sổ cái giao dịch tiền vào (webhook SePay + API tra cứu) ---------------
create table if not exists bank_transactions (
  id               bigint primary key,
  gateway          text,
  account_number   text,
  transaction_date timestamptz,
  content          text,
  code             text,
  transfer_type    text,
  amount           bigint,
  reference_code   text unique,                       -- chống xử lý trùng webhook (NFR-06)
  raw              jsonb,
  order_id         uuid references orders(id),
  result           text,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists bank_tx_code_idx on bank_transactions(code);

-- 4) Hồ sơ hoàn tiền ----------------------------------------------------
create table if not exists refunds (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  order_id           uuid not null references orders(id),
  order_code         text,
  amount             bigint not null check (amount > 0),
  reason             text not null check (reason in ('LATE','SEAT_TAKEN','NEAR_SHOWTIME','SHORT','EXCESS','DUPLICATE','MISMATCH')),
  status             text not null default 'REQUESTED' check (status in (
                       'REQUESTED','RETRYING','DONE','MANUAL_REVIEW','FORM_SUBMITTED','CS_APPROVED','ACC_RETURNED','PAID_OUT')),
  idempotency_key    text unique not null,             -- BR-04: chống hoàn trùng
  tx_refs            text,
  source_account     jsonb,
  attempts           int not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,
  deadline_at        timestamptz not null,             -- hạn tự hoàn 24 giờ
  is_manual          boolean not null default false,
  verified_at        timestamptz,                      -- mốc "Đối soát"
  reconciled_at      timestamptz,                      -- CSKH đối chiếu xong (thủ công)
  approved_at        timestamptz,                      -- mốc "Đã duyệt"
  done_at            timestamptz,                      -- mốc "Đã chuyển hoàn"
  accounting_paid_at timestamptz,
  refund_ref         text,
  bank_name          text,                             -- RefundForm
  acc_number         text,
  acc_name           text,
  receipt_url        text,
  form_submitted_at  timestamptz,
  cs_decision        text check (cs_decision in ('CAN_HOAN_TIEN','NGOAI_LE')),
  cs_note            text,
  acc_note           text,                             -- lý do Kế toán trả hồ sơ về nhân viên
  acc_returned_at    timestamptz,
  returned_count     int not null default 0,           -- số lần bị Kế toán trả về
  review_log         jsonb not null default '[]',      -- từng vòng Nhân viên <-> Kế toán (ai, lúc nào, ghi chú)
  created_at         timestamptz not null default now()
);
create index if not exists refunds_order_code_idx on refunds(order_code);
create index if not exists refunds_status_idx on refunds(status);

-- 5) Phiếu hỗ trợ cho CSKH (MANUAL_REVIEW, báo lỗi, tiền không khớp đơn) ----
create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  order_code  text,
  refund_code text,
  type        text not null check (type in ('PAYMENT_REPORT','MANUAL_REVIEW','DATA_MISMATCH','UNMATCHED_TX','GENERAL')),
  priority    text not null default 'HIGH',
  status      text not null default 'OPEN' check (status in ('OPEN','WAITING_CUSTOMER','WAITING_ACCOUNTING','RESOLVED')),
  summary     text,
  context     jsonb,                                  -- BR-11: ngữ cảnh giao dịch gom sẵn
  decision    text,
  note        text,
  updated_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists tickets_order_idx on support_tickets(order_code);

-- 6) Thông báo đa kênh (BR-09) -----------------------------------------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  order_code text,
  channel    text not null check (channel in ('WEB','EMAIL','SMS')),
  event      text,
  title      text,
  message    text,
  recipient  text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_order_idx on notifications(order_code);

-- 7) Nhật ký gọi API cổng thanh toán (NFR-13, NFR-14) --------------------
create table if not exists gateway_logs (
  id         uuid primary key default gen_random_uuid(),
  order_code text,
  api        text,      -- QUERY_STATUS | CANCEL_ORDER | REFUND
  phase      text,      -- WEBHOOK | SHORT_POLL | FINAL_CHECK | EXPIRY_CHECK | JOB_30M | REFUND | RETRY ...
  result     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gateway_logs_order_idx on gateway_logs(order_code);

-- 8) Bảo mật: bật RLS, không tạo policy => trình duyệt (anon key) không đọc được gì.
--    Chỉ /api (service_role key phía máy chủ) mới truy cập được.
alter table customers         enable row level security;
alter table orders            enable row level security;
alter table seat_holds        enable row level security;
alter table bank_transactions enable row level security;
alter table refunds           enable row level security;
alter table support_tickets   enable row level security;
alter table notifications     enable row level security;
alter table gateway_logs      enable row level security;

-- 9) Nhân viên nội bộ (lib/staff.js): Quản lý / Kế toán / CSKH / Quầy
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  full_name     text not null,
  role          text not null check (role in ('MANAGER','ACCOUNTANT','CS','COUNTER')),
  active        boolean not null default true,
  password_hash text not null,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- 10) Nhật ký thao tác nội bộ: ai làm gì, lúc nào, trên hồ sơ nào
create table if not exists audit_logs (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references staff(id),
  staff_name text,
  role       text,
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);
alter table staff      enable row level security;
alter table audit_logs enable row level security;
