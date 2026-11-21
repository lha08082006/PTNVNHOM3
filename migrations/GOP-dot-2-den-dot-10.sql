-- =====================================================================
-- GỘP MIGRATION ĐỢT 2 → ĐỢT 10 (8 file, từ 2026-11-24 tới 2026-12-01) – dán và chạy MỘT LẦN trong Supabase > SQL Editor.
-- Dùng khi database mới chạy tới 2026-11-23 (thiếu bảng đánh giá phim, phòng chiếu, banner…).
-- Mỗi phần chạy lại an toàn (create … if not exists / add column if not exists), chạy thừa phần đã có cũng không sao.
-- Thứ tự các phần đúng như file gốc trong thư mục migrations/:
--   1. 2026-11-24_dot-2-beta-club.sql
--   2. 2026-11-25_dot-3-phong-chieu-thue-rap.sql
--   3. 2026-11-26_dot-4-cong-thanh-toan-hoa-don.sql
--   4. 2026-11-27_dot-5-van-hanh-yeu-thich.sql
--   5. 2026-11-28_dot-6-du-lieu-ca-nhan-2fa-email.sql
--   6. 2026-11-29_dot-7-ke-toan-cskh-quay.sql
--   7. 2026-11-30_dot-9-trang-rap-xep-hang.sql
--   8. 2026-12-01_dot-10-banner-kho-anh.sql
-- Kiểm tra đúng dự án Supabase: mã dự án trên thanh địa chỉ (supabase.com/dashboard/project/<mã>) phải trùng SUPABASE_URL trên Vercel.
-- =====================================================================


-- ############################ 2026-11-24_dot-2-beta-club.sql ############################
-- =====================================================================
-- Đợt 2: điểm thưởng & hạng thành viên (Beta Club), đánh giá phim, mua bắp nước riêng.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-23). Chạy lại an toàn.
-- =====================================================================
begin;

-- Đơn hàng: loại đơn (vé / bắp nước) và số điểm đã dùng
alter table orders add column if not exists kind text not null default 'TICKET';
alter table orders add column if not exists points_used int not null default 0;
alter table orders drop constraint if exists orders_kind_check;
alter table orders add constraint orders_kind_check check (kind in ('TICKET','FNB'));

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

commit;


-- ############################ 2026-11-25_dot-3-phong-chieu-thue-rap.sql ############################
-- =====================================================================
-- Đợt 3: phòng chiếu có sơ đồ ghế riêng, thuê rạp / vé nhóm / Private Show, "Nhắc tôi khi mở bán".
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-24). Chạy lại an toàn.
-- =====================================================================
begin;

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

-- Suất chiếu gắn với phòng (trống = sơ đồ chuẩn 74 ghế như trước)
alter table showtimes add column if not exists room_id uuid references rooms(id);
create index if not exists showtimes_room_time_idx on showtimes(room_id, starts_at);

commit;


-- ############################ 2026-11-26_dot-4-cong-thanh-toan-hoa-don.sql ############################
-- =====================================================================
-- Đợt 4: thanh toán VNPay / MoMo / ZaloPay (phiên thanh toán), yêu cầu xuất hóa đơn điện tử.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-25). Chạy lại an toàn.
-- =====================================================================
begin;

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

commit;


-- ############################ 2026-11-27_dot-5-van-hanh-yeu-thich.sql ############################
-- =====================================================================
-- Đợt 5: ghi lỗi máy chủ + trạng thái vận hành (cảnh báo, cron, webhook), phim yêu thích.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-26). Chạy lại an toàn.
-- =====================================================================
begin;

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

commit;


-- ############################ 2026-11-28_dot-6-du-lieu-ca-nhan-2fa-email.sql ############################
-- =====================================================================
-- Đợt 6: đồng ý điều khoản / nhận email ưu đãi / xóa tài khoản, đăng nhập 2 lớp cho nhân viên,
-- chiến dịch email ưu đãi. Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-27). Chạy lại an toàn.
-- Khách đăng ký TRƯỚC đợt này: terms_accepted_at để trống (đã đồng ý theo checkbox cũ, không lưu thời điểm);
-- marketing_opt_in = false -> không nhận email quảng cáo cho tới khi tự bật trong Tài khoản.
-- =====================================================================
begin;

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

commit;


-- ############################ 2026-11-29_dot-7-ke-toan-cskh-quay.sql ############################
-- =====================================================================
-- Đợt 7: nâng cấp giao diện Kế toán / CSKH / Quầy – nhận xử lý phiếu, ghi chú nội bộ, chốt sổ ngày.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-28). Chạy lại an toàn.
-- =====================================================================
begin;

-- Phiếu hỗ trợ: nhân viên nhận xử lý + ghi chú nội bộ (khách không thấy)
alter table support_tickets add column if not exists assigned_to uuid;
alter table support_tickets add column if not exists assigned_name text;
alter table support_tickets add column if not exists assigned_at timestamptz;
alter table support_tickets add column if not exists internal_notes jsonb not null default '[]';
create index if not exists tickets_assigned_idx on support_tickets(assigned_to) where status <> 'RESOLVED';

-- Chốt sổ theo ngày của Kế toán: lưu ảnh chụp số liệu lúc chốt để phát hiện phát sinh sau chốt
create table if not exists day_closings (
  id           text primary key,                  -- = date
  date         text unique not null,              -- YYYY-MM-DD (giờ VN)
  summary      jsonb not null,
  note         text,
  closed_by    text,
  closed_by_id uuid,
  closed_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table day_closings enable row level security;

-- Tăng tốc tra cứu cho màn hình Kế toán / Quầy
create index if not exists bank_tx_date_idx on bank_transactions(transaction_date);
create index if not exists orders_showtime_status_idx on orders(showtime_key, status);
create index if not exists ticket_checkins_staff_idx on ticket_checkins(staff_id, created_at);

commit;


-- ############################ 2026-11-30_dot-9-trang-rap-xep-hang.sql ############################
-- =====================================================================
-- Đợt 8 + 9: giao diện điện thoại, tìm phim, mua vé nhanh, trang Rạp, xếp hạng phim bán chạy.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-29). Chạy lại an toàn.
-- =====================================================================
begin;

-- Trang Rạp: hotline, ảnh, giới thiệu, tiện ích của từng rạp (Quản lý nhập ở admin > Danh mục > Cụm rạp)
alter table cinemas add column if not exists phone     text;
alter table cinemas add column if not exists image     text;
alter table cinemas add column if not exists intro     text;
alter table cinemas add column if not exists amenities text;

-- Xếp hạng phim bán chạy 7 ngày (đếm đơn đã thanh toán theo ngày tạo)
create index if not exists orders_created_status_idx on orders(created_at, status);

commit;


-- ############################ 2026-12-01_dot-10-banner-kho-anh.sql ############################
-- =====================================================================
-- Đợt 10: banner trang chủ quản lý trong admin, kho ảnh (Supabase Storage) cho admin tải ảnh lên.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-30). Chạy lại an toàn.
-- =====================================================================
begin;

-- Banner trang chủ (Quản lý đổi ở admin > Danh mục > Banner). Chưa có banner nào -> trang chủ dùng ảnh mặc định
create table if not exists banners (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  image        text not null,
  image_mobile text,
  link         text,
  sort         int not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists banners_active_idx on banners(active, sort);
alter table banners enable row level security;

-- Kho ảnh công khai "media" cho poster / banner / ảnh rạp tải lên từ admin (máy chủ ghi bằng khóa service_role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2621440, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

commit;

-- Nhắc API của Supabase (PostgREST) nạp lại danh sách bảng / cột mới ngay
notify pgrst, 'reload schema';

-- Xong. Mở <tên-miền>/api/health?schema=1 phải thấy "schema":{"ok":true…}; <tên-miền>/api/catalog?action=showtimes&days=1 phải trả danh sách suất chiếu (không còn "Hệ thống đang bận").
