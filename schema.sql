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
