-- =====================================================================
-- Đợt 10: banner trang chủ quản lý trong admin, kho ảnh (Supabase Storage) cho admin tải ảnh lên.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-30). Chạy lại an toàn.
-- =====================================================================
begin;

-- Banner trang chủ (Quản lý đổi ở admin > Danh mục > Banner). Chưa có banner nào -> trang chủ dùng ảnh mặc định
create table if not exists banners (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  image        text not null,
  image_mobile text,
  link         text,
  sort         int not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists banners_active_idx on banners(active, sort);
alter table banners enable row level security;

-- Kho ảnh công khai "media" cho poster / banner / ảnh rạp tải lên từ admin (máy chủ ghi bằng khóa service_role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2621440, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

commit;
