-- =====================================================================
-- Đợt 3: phòng chiếu có sơ đồ ghế riêng, thuê rạp / vé nhóm / Private Show, "Nhắc tôi khi mở bán".
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-24). Chạy lại an toàn.
-- =====================================================================
begin;

-- Phòng chiếu có sơ đồ ghế riêng (rows: [{ r, type, n, gaps, off }])
create table if not exists rooms (
  id         uuid primary key default gen_random_uuid(),
  cinema_id  text not null references cinemas(id),
  name       text not null,
  kind       text,                                -- 2D / IMAX / 4DX ...
  layout     jsonb not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rooms_cinema_idx on rooms(cinema_id);

-- Thuê rạp / vé nhóm / Private Show / sự kiện / quảng cáo
create table if not exists event_requests (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,             -- EV-123456
  kind          text not null check (kind in ('PRIVATE_SHOW','GROUP','EVENT','ADS')),
  status        text not null default 'NEW' check (status in ('NEW','QUOTED','CONFIRMED','DONE','CANCELLED')),
  cinema_id     text,
  cinema_name   text,
  date          text,                             -- YYYY-MM-DD (giờ VN)
  time          text,                             -- HH:MM
  guests        int not null,
  movie_id      text,
  movie_title   text,
  contact_name  text not null,
  phone         text not null,
  email         text,
  company       text,
  note          text,
  customer_id   uuid,
  quote_amount  bigint,
  quote_note    text,
  staff_note    text,
  history       jsonb not null default '[]',
  updated_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists event_requests_status_idx on event_requests(status, created_at desc);

-- "Nhắc tôi khi mở bán": mỗi khách một dòng / phim
create table if not exists movie_watches (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  movie_id    text not null,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (customer_id, movie_id)
);

alter table rooms          enable row level security;
alter table event_requests enable row level security;
alter table movie_watches  enable row level security;

-- Suất chiếu gắn với phòng (trống = sơ đồ chuẩn 74 ghế như trước)
alter table showtimes add column if not exists room_id uuid references rooms(id);
create index if not exists showtimes_room_time_idx on showtimes(room_id, starts_at);

commit;
