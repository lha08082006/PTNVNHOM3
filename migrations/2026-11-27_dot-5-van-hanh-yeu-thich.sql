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
