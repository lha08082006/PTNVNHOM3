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
