-- =====================================================================
-- Hợp nhất từ nhánh GitHub: voucher có điều kiện + phản hồi phiếu hỗ trợ cho khách.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-22). Chạy lại an toàn.
-- =====================================================================
begin;

-- Voucher có điều kiện: giảm %, giảm theo ghế, đơn tối thiểu, kèm bắp nước, chỉ vài thứ trong tuần
alter table vouchers add column if not exists kind text not null default 'AMOUNT';
alter table vouchers add column if not exists percent int;
alter table vouchers add column if not exists max_discount bigint;
alter table vouchers add column if not exists min_total bigint;
alter table vouchers add column if not exists need_combo boolean not null default false;
alter table vouchers add column if not exists weekdays jsonb not null default '[]';
alter table vouchers drop constraint if exists vouchers_discount_check;
alter table vouchers add constraint vouchers_discount_check check (discount >= 0);
alter table vouchers drop constraint if exists vouchers_kind_check;
alter table vouchers add constraint vouchers_kind_check check (kind in ('AMOUNT','PERCENT','PER_SEAT'));
alter table vouchers drop constraint if exists vouchers_percent_check;
alter table vouchers add constraint vouchers_percent_check check (percent is null or percent between 1 and 100);

insert into vouchers (id, kind, discount, percent, max_discount, min_total, need_combo, weekdays, label, per_customer, active) values
  ('COMBO30',   'AMOUNT',  30000, null, null,  null,   true,  '[]',  'Giảm 30.000 đ khi mua kèm bắp nước', null, true),
  ('T3VUIVE',   'PERCENT', 0,     15,   40000, null,   false, '[2]', 'Suất chiếu thứ Ba giảm 15% (tối đa 40.000 đ)', null, true),
  ('NEWMEMBER', 'AMOUNT',  50000, null, null,  150000, false, '[]',  'Thành viên mới giảm 50.000 đ cho đơn từ 150.000 đ', 1, true)
on conflict (id) do nothing;

-- Phiếu hỗ trợ: thành viên xem phản hồi của CSKH và trả lời
alter table support_tickets add column if not exists customer_id uuid;
alter table support_tickets add column if not exists replies jsonb not null default '[]';
create index if not exists tickets_customer_idx on support_tickets(customer_id);
update support_tickets set customer_id = (context->'customer'->>'id')::uuid
  where customer_id is null and type = 'GENERAL' and context->'customer'->>'id' ~ '^[0-9a-f-]{36}$';

commit;
