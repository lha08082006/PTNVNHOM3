-- =====================================================================
-- Đợt 8 + 9: giao diện điện thoại, tìm phim, mua vé nhanh, trang Rạp, xếp hạng phim bán chạy.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-29). Chạy lại an toàn.
-- =====================================================================
begin;

-- Trang Rạp: hotline, ảnh, giới thiệu, tiện ích của từng rạp (Quản lý nhập ở admin > Danh mục > Cụm rạp)
alter table cinemas add column if not exists phone     text;
alter table cinemas add column if not exists image     text;
alter table cinemas add column if not exists intro     text;
alter table cinemas add column if not exists amenities text;

-- Xếp hạng phim bán chạy 7 ngày (đếm đơn đã thanh toán theo ngày tạo)
create index if not exists orders_created_status_idx on orders(created_at, status);

commit;
