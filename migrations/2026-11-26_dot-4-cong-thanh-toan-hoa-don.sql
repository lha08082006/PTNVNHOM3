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
