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
  kind            text not null default 'TICKET' check (kind in ('TICKET','FNB')),  -- FNB = đơn chỉ mua bắp nước
  points_used     int not null default 0,             -- điểm Beta Club đã dùng trả tiền (1 điểm = 1.000 đ)
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
  customer_id uuid,                                   -- thành viên gửi phiếu (xem & trả lời ở support.html)
  replies     jsonb not null default '[]',            -- [{at, from: STAFF|CUSTOMER, name, message}]
  updated_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists tickets_order_idx on support_tickets(order_code);
create index if not exists tickets_customer_idx on support_tickets(customer_id);

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

-- 11) Danh mục, soát vé, quên mật khẩu (xem migrations/2026-11-21_danh-muc-qr-otp.sql để có dữ liệu khởi tạo)
-- Phim (Quản lý sửa trên admin.html > Danh mục)
create table if not exists movies (
  id           text primary key,                  -- mã phim, vd: suzume
  title        text not null,
  short_title  text,
  age          text,
  meta         text,
  poster       text,
  format       text,
  badge        text,
  duration_min int,
  trailer      text,
  status       text not null default 'NOW' check (status in ('NOW','SOON','HIDDEN')),
  created_at   timestamptz not null default now()
);

-- Cụm rạp
create table if not exists cinemas (
  id         text primary key,                    -- vd: beta-thanh-xuan
  name       text not null,
  city       text,
  address    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Suất chiếu: giá ghế để null = dùng giá mặc định trong catalog.js
create table if not exists showtimes (
  id             uuid primary key default gen_random_uuid(),
  movie_id       text not null references movies(id),
  cinema_id      text not null references cinemas(id),
  starts_at      timestamptz not null,
  format         text,
  room           text,
  room_id        uuid,                                -- phòng có sơ đồ ghế riêng (Đợt 3); trống = sơ đồ chuẩn
  price_standard bigint,
  price_vip      bigint,
  price_sweetbox bigint,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (movie_id, cinema_id, starts_at)
);
create index if not exists showtimes_cinema_time_idx on showtimes(cinema_id, starts_at);
create index if not exists showtimes_movie_time_idx on showtimes(movie_id, starts_at);

-- Voucher: giới hạn tổng lượt, lượt mỗi khách, thời hạn
create table if not exists vouchers (
  id           text primary key,                  -- mã voucher (chữ in hoa)
  kind         text not null default 'AMOUNT' check (kind in ('AMOUNT','PERCENT','PER_SEAT')),
  discount     bigint not null default 0 check (discount >= 0),   -- số tiền giảm (AMOUNT / mỗi ghế với PER_SEAT)
  percent      int check (percent between 1 and 100),             -- % giảm (PERCENT)
  max_discount bigint,                            -- trần tiền giảm
  min_total    bigint,                            -- đơn tối thiểu (trước giảm)
  need_combo   boolean not null default false,    -- phải mua kèm bắp nước
  weekdays     jsonb not null default '[]',       -- chỉ suất chiếu vào các thứ này (0 = CN); [] = mọi ngày
  label        text,
  max_uses     int,
  per_customer int,
  starts_at    timestamptz,
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists orders_voucher_idx on orders(voucher);

-- Soát vé tại quầy: mỗi đơn chỉ soát một lần (unique order_id)
create table if not exists ticket_checkins (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references orders(id),
  order_code text,
  staff_id   uuid references staff(id),
  staff_name text,
  method     text,                                -- QR | CODE
  created_at timestamptz not null default now()
);

-- Quên mật khẩu: mã 6 số (lưu dạng băm), hết hạn 15 phút
create table if not exists password_resets (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Chặn dò mật khẩu: đếm lần sai theo tài khoản
create table if not exists auth_throttle (
  id           text primary key,                  -- c:<email/sđt> | s:<email nhân viên> | f:/r:<email>
  fails        int not null default 0,
  window_start timestamptz,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

alter table movies          enable row level security;
alter table cinemas         enable row level security;
alter table showtimes       enable row level security;
alter table vouchers        enable row level security;
alter table ticket_checkins enable row level security;
alter table password_resets enable row level security;
alter table auth_throttle   enable row level security;

-- 12) Đợt 1: bảng giá, loại vé, ngày lễ, tin tức & ưu đãi (dữ liệu mẫu: migrations/2026-11-22_dot-1-gia-ve-tin-tuc.sql)
-- Loại vé theo đối tượng (giảm vào giá ghế thường / VIP; không áp dụng ghế đôi)
create table if not exists ticket_types (
  id         text primary key,                    -- ADULT | STUDENT | CHILD | SENIOR | ...
  label      text not null,
  off        bigint not null default 0 check (off >= 0),
  note       text,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- Quy tắc giá theo thứ / ngày lễ / khung giờ (priority thấp áp trước, cao áp sau; giá null = giữ giá trước)
create table if not exists price_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  days           jsonb not null default '[]',      -- [0..6], 0 = Chủ nhật
  holiday        boolean not null default false,   -- áp dụng cho ngày trong bảng holidays
  start_time     text not null default '00:00',
  end_time       text not null default '24:00',
  price_standard bigint,
  price_vip      bigint,
  price_sweetbox bigint,
  priority       int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Ngày lễ, Tết (YYYY-MM-DD theo giờ Việt Nam)
create table if not exists holidays (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Tin tức & ưu đãi (nội dung chữ thuần)
create table if not exists posts (
  id         text primary key,                    -- slug
  title      text not null,
  type       text not null check (type in ('PROMO','NEWS','EVENT')),
  summary    text,
  body       text,
  image      text,
  movie_id   text references movies(id),
  cinema_id  text references cinemas(id),
  starts_at  timestamptz,
  ends_at    timestamptz,
  published  boolean not null default false,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_published_idx on posts(published, created_at desc);

-- Đơn: loại vé và giá thực trả của từng ghế (hóa đơn dùng đúng số này)
alter table orders
  add column if not exists ticket_types jsonb not null default '{}',
  add column if not exists seat_prices  jsonb not null default '{}';

-- Phim: thông tin chi tiết
alter table movies
  add column if not exists genre        text,
  add column if not exists language     text,
  add column if not exists director     text,
  add column if not exists cast_list    text,
  add column if not exists release_date date,
  add column if not exists synopsis     text;

-- Rạp: tọa độ cho "Rạp gần tôi"
alter table cinemas
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table ticket_types enable row level security;
alter table price_rules  enable row level security;
alter table holidays     enable row level security;
alter table posts        enable row level security;

-- ===================== Đợt 2: Beta Club, đánh giá phim, bắp nước =====================
-- Beta Club: sổ điểm chỉ ghi thêm; "ref" duy nhất để cộng/trừ không bị trùng
create table if not exists point_ledger (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique not null,            -- EARN:<đơn> | REDEEM:<đơn> | RETURN:<đơn> | BDAY:<khách>:<năm> | EXPIRE:<khách>:<ngày>
  customer_id uuid not null references customers(id),
  order_code  text,
  kind        text not null check (kind in ('EARN','REDEEM','RETURN','BIRTHDAY','EXPIRE','ADJUST')),
  points      int not null,                    -- dương = cộng, âm = trừ
  expires_at  timestamptz,                     -- hạn dùng của dòng cộng điểm
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists point_ledger_customer_idx on point_ledger(customer_id, created_at desc);

-- Đánh giá phim: chỉ khách đã soát vé, mỗi đơn vé một đánh giá
create table if not exists movie_reviews (
  id            uuid primary key default gen_random_uuid(),
  movie_id      text not null,
  customer_id   uuid not null references customers(id),
  customer_name text,                          -- tên rút gọn hiển thị công khai ("An N.")
  order_code    text unique not null,
  rating        int not null check (rating between 1 and 5),
  content       text,
  hidden        boolean not null default false,
  moderated_by  text,
  moderated_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists movie_reviews_movie_idx on movie_reviews(movie_id, hidden, created_at desc);

alter table point_ledger  enable row level security;
alter table movie_reviews enable row level security;

-- ===================== Đợt 3: phòng chiếu, thuê rạp, nhắc mở bán =====================
-- Phòng chiếu có sơ đồ ghế riêng (rows: [{ r, type, n, gaps, off }])
create table if not exists rooms (
  id         uuid primary key default gen_random_uuid(),
  cinema_id  text not null references cinemas(id),
  name       text not null,
  kind       text,                                -- 2D / IMAX / 4DX ...
  layout     jsonb not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rooms_cinema_idx on rooms(cinema_id);

-- Thuê rạp / vé nhóm / Private Show / sự kiện / quảng cáo
create table if not exists event_requests (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,             -- EV-123456
  kind          text not null check (kind in ('PRIVATE_SHOW','GROUP','EVENT','ADS')),
  status        text not null default 'NEW' check (status in ('NEW','QUOTED','CONFIRMED','DONE','CANCELLED')),
  cinema_id     text,
  cinema_name   text,
  date          text,                             -- YYYY-MM-DD (giờ VN)
  time          text,                             -- HH:MM
  guests        int not null,
  movie_id      text,
  movie_title   text,
  contact_name  text not null,
  phone         text not null,
  email         text,
  company       text,
  note          text,
  customer_id   uuid,
  quote_amount  bigint,
  quote_note    text,
  staff_note    text,
  history       jsonb not null default '[]',
  updated_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists event_requests_status_idx on event_requests(status, created_at desc);

-- "Nhắc tôi khi mở bán": mỗi khách một dòng / phim
create table if not exists movie_watches (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  movie_id    text not null,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (customer_id, movie_id)
);

alter table rooms          enable row level security;
alter table event_requests enable row level security;
alter table movie_watches  enable row level security;

-- ===================== Đợt 4: cổng ví / thẻ, hóa đơn điện tử =====================
-- Phiên thanh toán qua cổng ví / thẻ (VNPay, MoMo, ZaloPay). Tiền thật vẫn ghi vào bank_transactions.
create table if not exists payment_attempts (
  id           uuid primary key default gen_random_uuid(),
  order_code   text not null,
  provider     text not null check (provider in ('VNPAY','MOMO','ZALOPAY')),
  provider_ref text,                               -- mã giao dịch phía Beta gửi cổng (vnp_TxnRef / orderId / app_trans_id)
  provider_txn text,                               -- mã giao dịch của cổng khi thành công
  amount       bigint not null,
  status       text not null default 'INIT' check (status in ('INIT','PAID','FAILED')),
  pay_url      text,
  updated_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists payment_attempts_order_idx on payment_attempts(order_code);

-- Yêu cầu xuất hóa đơn điện tử
create table if not exists invoice_requests (
  id             uuid primary key default gen_random_uuid(),
  order_code     text unique not null,
  customer_id    uuid,
  buyer_type     text not null check (buyer_type in ('COMPANY','PERSONAL')),
  tax_code       text,
  company_name   text,
  address        text,
  buyer_name     text,
  email          text not null,
  amount         bigint not null,
  status         text not null default 'PENDING' check (status in ('PENDING','ISSUED','CANCELLED')),
  provider       text,                             -- MANUAL | VNPT | VIETTEL | MISA ...
  invoice_no     text,
  invoice_series text,
  lookup_url     text,
  issued_at      timestamptz,
  issued_by      text,
  note           text,
  updated_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists invoice_requests_status_idx on invoice_requests(status, created_at desc);

alter table payment_attempts enable row level security;
alter table invoice_requests enable row level security;

-- ===================== Đợt 5: vận hành, phim yêu thích =====================
-- Phim yêu thích của thành viên
create table if not exists favorites (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  movie_id    text not null,
  created_at  timestamptz not null default now(),
  unique (customer_id, movie_id)
);

-- Lỗi máy chủ (5xx, webhook bị từ chối) – xem ở admin.html > IT
create table if not exists error_logs (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  message    text not null,
  stack      text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists error_logs_created_idx on error_logs(created_at desc);

-- Trạng thái vận hành: lần chạy cron / webhook gần nhất, thời điểm gửi cảnh báo (chống gửi trùng)
create table if not exists system_state (
  id         text primary key,
  value      jsonb,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table favorites    enable row level security;
alter table error_logs   enable row level security;
alter table system_state enable row level security;

-- ===================== Đợt 6: dữ liệu cá nhân, bảo mật 2 lớp, email ưu đãi =====================
-- Khách: đồng ý điều khoản, nhận email quảng cáo, xóa tài khoản (NĐ 13/2023)
alter table customers add column if not exists terms_version text;
alter table customers add column if not exists terms_accepted_at timestamptz;
alter table customers add column if not exists marketing_opt_in boolean not null default false;
alter table customers add column if not exists marketing_opt_in_at timestamptz;
alter table customers add column if not exists deleted_at timestamptz;

-- Nhân viên: đăng nhập 2 lớp (khóa bí mật được mã hóa bằng AUTH_SECRET)
alter table staff add column if not exists totp_enabled boolean not null default false;
alter table staff add column if not exists totp_secret text;
alter table staff add column if not exists totp_pending text;
alter table staff add column if not exists totp_last_step bigint;

-- Chiến dịch email ưu đãi (gửi theo đợt; recipients = danh sách id khách tại lúc tạo)
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  message     text not null,
  segment     text not null,
  param       text,
  recipients  jsonb not null default '[]',
  cursor      int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  skipped     int not null default 0,
  status      text not null default 'SENDING' check (status in ('SENDING','DONE')),
  created_by  text,
  updated_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists customers_marketing_idx on customers(marketing_opt_in) where marketing_opt_in;
alter table campaigns enable row level security;

