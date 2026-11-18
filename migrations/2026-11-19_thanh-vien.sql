-- =====================================================================
-- Giai đoạn 1: tài khoản thành viên thật (bảng customers) + gắn đơn với thành viên.
-- Chạy MỘT LẦN trong Supabase > SQL Editor trước khi deploy code mới. Chạy lại an toàn.
-- Nhớ đặt biến môi trường AUTH_SECRET (chuỗi ngẫu nhiên dài) trên Vercel.
-- =====================================================================
begin;

create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  phone         text unique,
  full_name     text not null,
  birthday      date,
  password_hash text not null,
  created_at    timestamptz not null default now()
);
alter table customers enable row level security;

-- orders.user_id trước đây trỏ tới auth.users (chưa dùng) -> chuyển sang customers
alter table orders drop constraint if exists orders_user_id_fkey;
update orders set user_id = null where user_id is not null and user_id not in (select id from customers);
alter table orders add constraint orders_user_id_fkey foreign key (user_id) references customers(id);
create index if not exists orders_user_idx on orders(user_id);

commit;
