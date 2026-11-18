-- =====================================================================
-- Tài khoản nhân viên riêng + phân quyền + nhật ký thao tác (thay ADMIN_KEY dùng chung).
-- Sau khi chạy: mở admin.html, tạo tài khoản Quản lý đầu tiên bằng ADMIN_KEY.
-- Hoàn tiền thủ công: Kế toán kiểm tra lại, không đạt thì TRẢ VỀ nhân viên (ACC_RETURNED).
-- Chạy MỘT LẦN trong Supabase > SQL Editor trước khi deploy code mới. Chạy lại an toàn.
-- =====================================================================
begin;

alter table refunds drop constraint if exists refunds_status_check;
alter table refunds add constraint refunds_status_check check (status in (
  'REQUESTED','RETRYING','DONE','MANUAL_REVIEW','FORM_SUBMITTED','CS_APPROVED','ACC_RETURNED','PAID_OUT'));

alter table refunds
  add column if not exists acc_note        text,
  add column if not exists acc_returned_at timestamptz,
  add column if not exists returned_count  int not null default 0,
  add column if not exists review_log      jsonb not null default '[]';


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

commit;
