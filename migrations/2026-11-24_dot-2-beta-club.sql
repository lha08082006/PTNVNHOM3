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
