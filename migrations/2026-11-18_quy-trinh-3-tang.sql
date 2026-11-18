-- =====================================================================
-- Nâng cấp DB đang chạy (schema cũ HOLDING/PAID...) lên quy trình 3 tầng.
-- Chạy MỘT LẦN trong Supabase > SQL Editor TRƯỚC khi deploy code mới.
-- Có thể chạy lại an toàn (idempotent).
-- =====================================================================
begin;

-- orders -----------------------------------------------------------------
alter table orders drop constraint if exists orders_status_check;
alter table orders
  add column if not exists email          text,
  add column if not exists customer_name  text,
  add column if not exists show_at        timestamptz,
  add column if not exists check_seq      int not null default 0,
  add column if not exists last_check_at  timestamptz,
  add column if not exists reported_at    timestamptz,
  add column if not exists expired_at     timestamptz,
  add column if not exists scan_until     timestamptz,
  add column if not exists job_checked_at timestamptz,
  add column if not exists confirmed_at   timestamptz,
  add column if not exists manual_reason  text,
  add column if not exists source_account jsonb,
  add column if not exists sandbox        jsonb,
  add column if not exists history        jsonb not null default '[]';

update orders set status = 'PENDING'   where status in ('HOLDING','PARTIAL');
update orders set status = 'CONFIRMED', confirmed_at = coalesce(paid_at, created_at) where status = 'PAID';
-- Đơn EXPIRED cũ: cho vào ScanList 24 giờ kể từ khi hết hạn (nếu đã quá 24 giờ, Job sẽ tự đóng đơn)
update orders set expired_at = coalesce(expired_at, hold_expires_at),
                  scan_until = coalesce(scan_until, hold_expires_at + interval '24 hours')
  where status = 'EXPIRED';
alter table orders alter column status set default 'PENDING';
alter table orders add constraint orders_status_check check (status in (
  'PENDING','CONFIRMED','CANCELLED','FAILED','EXPIRED',
  'CONFIRMED_LATE','REFUND_REQUESTED','REFUNDED','MANUAL_REVIEW'));
create index if not exists orders_status_idx on orders(status);
create index if not exists seat_holds_order_idx on seat_holds(order_id);

-- bank_transactions --------------------------------------------------------
alter table bank_transactions drop constraint if exists bank_transactions_result_check;
-- Gộp các bản ghi trùng mã giao dịch (nếu có) trước khi đặt unique
delete from bank_transactions a using bank_transactions b
  where a.reference_code = b.reference_code and a.id > b.id;
create unique index if not exists bank_tx_ref_uq on bank_transactions(reference_code);

-- refunds ----------------------------------------------------------------
alter table refunds drop constraint if exists refunds_status_check;
alter table refunds drop constraint if exists refunds_reason_check;
drop index if exists refunds_tx_reason_uq;
drop trigger if exists refunds_touch on refunds;
drop function if exists touch_refund();
alter table refunds
  add column if not exists order_code         text,
  add column if not exists idempotency_key    text,
  add column if not exists tx_refs            text,
  add column if not exists source_account     jsonb,
  add column if not exists attempts           int not null default 0,
  add column if not exists last_attempt_at    timestamptz,
  add column if not exists last_error         text,
  add column if not exists deadline_at        timestamptz,
  add column if not exists is_manual          boolean not null default false,
  add column if not exists verified_at        timestamptz,
  add column if not exists accounting_paid_at timestamptz,
  add column if not exists receipt_url        text,
  add column if not exists form_submitted_at  timestamptz,
  add column if not exists cs_decision        text,
  add column if not exists cs_note            text;

update refunds r set order_code = o.code from orders o where r.order_id = o.id and r.order_code is null;
update refunds set idempotency_key = coalesce(idempotency_key, 'legacy:' || code),
                   deadline_at     = coalesce(deadline_at, created_at + interval '24 hours');
update refunds set reason = 'MISMATCH' where reason = 'SYSTEM_ERROR';
-- Hồ sơ cũ: WAITING_INFO -> chờ khách điền form; RECEIVED/RECONCILING -> đã có form;
-- APPROVED -> CSKH đã duyệt chờ Kế toán; DONE giữ nguyên.
update refunds set status = 'MANUAL_REVIEW',  is_manual = true where status = 'WAITING_INFO';
update refunds set status = 'FORM_SUBMITTED', is_manual = true, form_submitted_at = coalesce(received_at, created_at) where status in ('RECEIVED','RECONCILING');
update refunds set status = 'CS_APPROVED',    is_manual = true where status = 'APPROVED';
update refunds set is_manual = true where status = 'DONE' and refund_ref is not null and verified_at is null;
alter table refunds alter column status set default 'REQUESTED';
alter table refunds alter column idempotency_key set not null;
alter table refunds alter column deadline_at set not null;
alter table refunds add constraint refunds_status_check check (status in (
  'REQUESTED','RETRYING','DONE','MANUAL_REVIEW','FORM_SUBMITTED','CS_APPROVED','PAID_OUT'));
alter table refunds add constraint refunds_reason_check check (reason in (
  'LATE','SEAT_TAKEN','NEAR_SHOWTIME','SHORT','EXCESS','DUPLICATE','MISMATCH'));
create unique index if not exists refunds_idem_uq on refunds(idempotency_key);
create index if not exists refunds_order_code_idx on refunds(order_code);
create index if not exists refunds_status_idx on refunds(status);

-- Đơn cũ có hồ sơ hoàn tiền chưa xong -> MANUAL_REVIEW; đã xong -> REFUNDED
update orders o set status = 'MANUAL_REVIEW'
  where o.status in ('EXPIRED','CANCELLED')
    and exists (select 1 from refunds r where r.order_id = o.id and r.status <> 'DONE');
update orders o set status = 'REFUNDED'
  where o.status in ('EXPIRED','CANCELLED')
    and exists (select 1 from refunds r where r.order_id = o.id and r.status = 'DONE');

-- bảng mới ---------------------------------------------------------------
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, order_code text, refund_code text,
  type text not null check (type in ('PAYMENT_REPORT','MANUAL_REVIEW','DATA_MISMATCH','UNMATCHED_TX')),
  priority text not null default 'HIGH',
  status text not null default 'OPEN' check (status in ('OPEN','WAITING_CUSTOMER','WAITING_ACCOUNTING','RESOLVED')),
  summary text, context jsonb, decision text, note text, updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tickets_order_idx on support_tickets(order_code);

-- Chuyển khiếu nại cũ sang phiếu hỗ trợ
insert into support_tickets (code, order_code, type, priority, status, summary, context, created_at)
select c.code, c.order_code, 'PAYMENT_REPORT', 'HIGH',
       case when c.status = 'RESOLVED' then 'RESOLVED' else 'OPEN' end,
       c.description, jsonb_build_object('bank_ref', c.bank_ref, 'phone', c.phone, 'amount', c.amount), c.created_at
from complaints c
on conflict (code) do nothing;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  order_code text, channel text not null check (channel in ('WEB','EMAIL','SMS')),
  event text, title text, message text, recipient text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_order_idx on notifications(order_code);

create table if not exists gateway_logs (
  id uuid primary key default gen_random_uuid(),
  order_code text, api text, phase text, result text, detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gateway_logs_order_idx on gateway_logs(order_code);

alter table support_tickets enable row level security;
alter table notifications   enable row level security;
alter table gateway_logs    enable row level security;

commit;
