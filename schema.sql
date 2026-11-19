-- =====================================================================
-- Beta Cinemas - schema thanh toán (Supabase / Postgres)
-- Dán toàn bộ file này vào Supabase > SQL Editor > New query > Run
-- =====================================================================
create extension if not exists pgcrypto;

-- 1) Đơn đặt vé -------------------------------------------------------
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,               -- BC2610289854: cũng là NỘI DUNG CHUYỂN KHOẢN
  user_id         uuid references auth.users(id),     -- null nếu khách không đăng nhập
  phone           text,
  movie_key       text,
  cinema          text,
  show_date       text,
  show_time       text,
  showtime_key    text not null,                      -- phim|rạp|ngày|giờ (để khóa ghế theo suất)
  seats           jsonb not null default '[]',        -- ["D5","D6"]
  combos          jsonb not null default '{}',        -- {"solo":1}
  voucher         text,
  total           bigint not null check (total >= 0), -- số tiền phải trả (tính ở server)
  paid_amount     bigint not null default 0,          -- số tiền đã nhận được (cộng dồn)
  status          text not null default 'HOLDING'
                  check (status in ('HOLDING','PARTIAL','PAID','EXPIRED','CANCELLED')),
  hold_expires_at timestamptz not null,               -- hết giờ giữ ghế (10 phút)
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- 2) Ghế đang giữ / đã bán (khóa duy nhất theo suất + ghế) --------------
create table if not exists seat_holds (
  showtime_key text not null,
  seat_id      text not null,
  order_id     uuid not null references orders(id) on delete cascade,
  status       text not null default 'HELD' check (status in ('HELD','SOLD')),
  expires_at   timestamptz,
  primary key (showtime_key, seat_id)
);

-- 3) Mọi giao dịch tiền VÀO mà SePay báo về (lưu nguyên bản để đối soát) ---
create table if not exists bank_transactions (
  id               bigint primary key,                -- "id" giao dịch của SePay -> chống xử lý trùng
  gateway          text,
  account_number   text,
  transaction_date timestamptz,
  content          text,
  code             text,
  transfer_type    text,
  amount           bigint,
  reference_code   text,                              -- mã giao dịch ngân hàng (FT..., MBVCB...)
  raw              jsonb,
  order_id         uuid references orders(id),
  result           text check (result in
                   ('OK','SHORT','EXCESS','LATE','DUPLICATE','RECOVERED','UNMATCHED','IGNORED','ERROR')),
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists bank_tx_ref_idx  on bank_transactions(reference_code);
create index if not exists bank_tx_code_idx on bank_transactions(code);

-- 4) Hồ sơ hoàn tiền (khớp 4 bước ở trang refund-track) -------------------
create table if not exists refunds (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,                 -- REF-2610-889
  order_id      uuid not null references orders(id),
  bank_tx_id    bigint references bank_transactions(id),
  amount        bigint not null check (amount > 0),
  reason        text not null check (reason in ('LATE','SHORT','EXCESS','DUPLICATE','SYSTEM_ERROR')),
  status        text not null default 'WAITING_INFO'
                check (status in ('WAITING_INFO','RECEIVED','RECONCILING','APPROVED','DONE')),
  bank_name     text,
  acc_number    text,
  acc_name      text,
  received_at   timestamptz,
  reconciled_at timestamptz,
  approved_at   timestamptz,
  done_at       timestamptz,
  refund_ref    text,                                 -- mã giao dịch hoàn tiền (nhân viên nhập khi DONE)
  created_at    timestamptz not null default now()
);
create unique index if not exists refunds_tx_reason_uq
  on refunds(bank_tx_id, reason) where bank_tx_id is not null;

-- Tự điền mốc thời gian khi nhân viên đổi cột status trong Table Editor
create or replace function touch_refund() returns trigger as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'RECEIVED'    then new.received_at   := now(); end if;
    if new.status = 'RECONCILING' then new.reconciled_at := now(); end if;
    if new.status = 'APPROVED'    then new.approved_at   := now(); end if;
    if new.status = 'DONE'        then new.done_at       := now(); end if;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists refunds_touch on refunds;
create trigger refunds_touch before update on refunds
  for each row execute function touch_refund();

-- 5) Khiếu nại (khi không tìm thấy giao dịch ở bất kỳ đâu) ---------------
create table if not exists complaints (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                   -- CS-2610-123
  bank_ref    text,
  order_code  text,
  phone       text,
  amount      bigint,
  description text,
  status      text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  created_at  timestamptz not null default now()
);

-- 6) Bảo mật: bật RLS và KHÔNG tạo policy => trình duyệt (anon key) không đọc được gì.
--    Chỉ các hàm /api (dùng service_role key ở server) mới truy cập được.
alter table orders            enable row level security;
alter table seat_holds        enable row level security;
alter table bank_transactions enable row level security;
alter table refunds           enable row level security;
alter table complaints        enable row level security;

-- =====================================================================
-- BỔ SUNG CHO CÁC CHỨC NĂNG GIAO DIỆN MỚI (chạy lại an toàn nhiều lần)
-- Ánh xạ khóa localStorage -> bảng: xem public/js/store.js
-- =====================================================================

-- 7) Đơn hàng: thêm thông tin khách, voucher và trạng thái hoàn tiền ------
alter table orders add column if not exists customer_name text;
alter table orders add column if not exists email         text;
alter table orders add column if not exists discount      bigint not null default 0;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('HOLDING','PARTIAL','PAID','EXPIRED','CANCELLED','REFUNDING','REFUNDED'));
create index if not exists orders_phone_idx on orders(phone);

-- Hồ sơ hoàn tiền: thêm bước "nhân viên xử lý" (bước 4/5 ở refund-track)
alter table refunds drop constraint if exists refunds_status_check;
alter table refunds add constraint refunds_status_check
  check (status in ('WAITING_INFO','RECEIVED','RECONCILING','FALLBACK_STAFF','APPROVED','DONE'));

-- 8) Hồ sơ thành viên (đăng nhập dùng Supabase Auth: auth.users) ----------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  phone      text unique,
  dob        date,
  role       text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

-- 9) Suất chiếu (hiện sinh tự động ở public/js/showtimes.js) --------------
create table if not exists showtimes (
  id         uuid primary key default gen_random_uuid(),
  movie_key  text not null,
  cinema     text not null,
  show_date  date not null,
  show_time  time not null,
  format     text not null default '2D Phụ đề',
  room       text not null default 'Phòng 01',
  unique (movie_key, cinema, show_date, show_time)
);
create index if not exists showtimes_lookup_idx on showtimes(cinema, show_date);

-- 10) Voucher ------------------------------------------------------------
create table if not exists vouchers (
  code         text primary key,
  title        text not null,
  type         text not null check (type in ('percent','amount','perSeat')),
  value        bigint not null check (value > 0),
  max_discount bigint,
  min_total    bigint,
  need_combo   boolean not null default false,
  weekday      smallint check (weekday between 0 and 6),   -- 2 = thứ Ba
  once_per_user boolean not null default false,
  expires_at   date not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists voucher_usages (
  voucher_code text not null references vouchers(code),
  user_id      uuid not null references auth.users(id),
  order_id     uuid references orders(id),
  used_at      timestamptz not null default now(),
  primary key (voucher_code, user_id, used_at)
);

insert into vouchers (code, title, type, value, max_discount, min_total, need_combo, weekday, once_per_user, expires_at) values
  ('BETAVIP',   'Thành viên VIP giảm 20%',                'percent', 20,    50000, 100000, false, null, false, '2026-12-31'),
  ('NEWMEMBER', 'Thành viên mới giảm 50.000đ',            'amount',  50000, null,  150000, false, null, true,  '2026-12-31'),
  ('COMBO30',   'Giảm 30.000đ khi mua kèm bắp nước',      'amount',  30000, null,  null,   true,  null, false, '2026-12-31'),
  ('T3VUIVE',   'Thứ Ba vui vẻ giảm 15%',                 'percent', 15,    40000, null,   false, 2,    false, '2026-12-31'),
  ('HSSV',      'Học sinh - sinh viên giảm 10.000đ / vé', 'perSeat', 10000, null,  null,   false, null, false, '2026-12-31')
on conflict (code) do nothing;

-- 11) Phiếu hỗ trợ / khiếu nại và phản hồi CSKH ---------------------------
create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                    -- CS-123456
  user_id     uuid references auth.users(id),
  type        text not null,
  order_code  text,
  phone       text not null,
  amount      bigint,
  description text not null,
  status      text not null default 'NEW' check (status in ('NEW','PROCESSING','DONE')),
  created_at  timestamptz not null default now()
);

create table if not exists ticket_replies (
  id         bigserial primary key,
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  author_id  uuid references auth.users(id),
  text       text not null,
  created_at timestamptz not null default now()
);

alter table profiles        enable row level security;
alter table showtimes       enable row level security;
alter table vouchers        enable row level security;
alter table voucher_usages  enable row level security;
alter table support_tickets enable row level security;
alter table ticket_replies  enable row level security;

-- Ai cũng xem được suất chiếu và voucher đang hoạt động; còn lại chỉ đi qua /api (service_role)
drop policy if exists showtimes_public_read on showtimes;
create policy showtimes_public_read on showtimes for select using (true);
drop policy if exists vouchers_public_read on vouchers;
create policy vouchers_public_read on vouchers for select using (active and expires_at >= current_date);
-- Thành viên chỉ đọc / sửa hồ sơ của chính mình
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for all using (auth.uid() = id) with check (auth.uid() = id and role = 'member');
