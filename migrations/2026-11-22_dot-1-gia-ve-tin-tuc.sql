-- =====================================================================
-- Đợt 1 nâng cấp: loại vé & giá theo ngày/khung giờ, ngày lễ, tin tức & ưu đãi,
-- thông tin phim chi tiết, tọa độ rạp. Sinh bởi tools/gen-dot1-migration.js.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-21). Chạy lại an toàn.
-- Giá trong price_rules và bài trong posts là MẪU – Quản lý sửa ở admin.html > Danh mục.
-- =====================================================================
begin;

-- Loại vé theo đối tượng (giảm vào giá ghế thường / VIP; không áp dụng ghế đôi)
create table if not exists ticket_types (
  id         text primary key,                    -- ADULT | STUDENT | CHILD | SENIOR | ...
  label      text not null,
  off        bigint not null default 0 check (off >= 0),
  note       text,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- Quy tắc giá theo thứ / ngày lễ / khung giờ (priority thấp áp trước, cao áp sau; giá null = giữ giá trước)
create table if not exists price_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  days           jsonb not null default '[]',      -- [0..6], 0 = Chủ nhật
  holiday        boolean not null default false,   -- áp dụng cho ngày trong bảng holidays
  start_time     text not null default '00:00',
  end_time       text not null default '24:00',
  price_standard bigint,
  price_vip      bigint,
  price_sweetbox bigint,
  priority       int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Ngày lễ, Tết (YYYY-MM-DD theo giờ Việt Nam)
create table if not exists holidays (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Tin tức & ưu đãi (nội dung chữ thuần)
create table if not exists posts (
  id         text primary key,                    -- slug
  title      text not null,
  type       text not null check (type in ('PROMO','NEWS','EVENT')),
  summary    text,
  body       text,
  image      text,
  movie_id   text references movies(id),
  cinema_id  text references cinemas(id),
  starts_at  timestamptz,
  ends_at    timestamptz,
  published  boolean not null default false,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_published_idx on posts(published, created_at desc);

-- Đơn: loại vé và giá thực trả của từng ghế (hóa đơn dùng đúng số này)
alter table orders
  add column if not exists ticket_types jsonb not null default '{}',
  add column if not exists seat_prices  jsonb not null default '{}';

-- Phim: thông tin chi tiết
alter table movies
  add column if not exists genre        text,
  add column if not exists language     text,
  add column if not exists director     text,
  add column if not exists cast_list    text,
  add column if not exists release_date date,
  add column if not exists synopsis     text;

-- Rạp: tọa độ cho "Rạp gần tôi"
alter table cinemas
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table ticket_types enable row level security;
alter table price_rules  enable row level security;
alter table holidays     enable row level security;
alter table posts        enable row level security;

-- Dữ liệu mẫu (bỏ qua nếu đã có)
insert into ticket_types (id, label, off, note, active, sort) values ('ADULT', 'Người lớn', 0, '', true, 0) on conflict (id) do nothing;
insert into ticket_types (id, label, off, note, active, sort) values ('STUDENT', 'HSSV / U22', 10000, 'Xuất trình thẻ học sinh, sinh viên hoặc CCCD (dưới 22 tuổi) khi soát vé', true, 1) on conflict (id) do nothing;
insert into ticket_types (id, label, off, note, active, sort) values ('CHILD', 'Trẻ em', 15000, 'Dưới 13 tuổi hoặc cao dưới 1m30; phim phải phù hợp độ tuổi', true, 2) on conflict (id) do nothing;
insert into ticket_types (id, label, off, note, active, sort) values ('SENIOR', 'Người cao tuổi', 15000, 'Từ 60 tuổi, xuất trình CCCD khi soát vé', true, 3) on conflict (id) do nothing;
insert into price_rules (name, days, holiday, start_time, end_time, price_standard, price_vip, price_sweetbox, priority)
select * from (values
  ('Ngày thường (T2–T5)', '[1,2,3,4]'::jsonb, false, '00:00', '24:00', 45000, 50000, 100000, 10),
  ('Cuối tuần (T6–CN)', '[5,6,0]'::jsonb, false, '00:00', '24:00', 55000, 60000, 120000, 10),
  ('Ngày lễ, Tết', '[]'::jsonb, true, '00:00', '24:00', 65000, 70000, 140000, 15),
  ('Suất sớm (trước 10:00)', '[0,1,2,3,4,5,6]'::jsonb, false, '00:00', '10:00', 40000, 45000, 90000, 20),
  ('Suất khuya (từ 22:00)', '[0,1,2,3,4,5,6]'::jsonb, false, '22:00', '24:00', 45000, 50000, 100000, 20),
  ('Thứ Ba vui vẻ', '[2]'::jsonb, false, '00:00', '24:00', 40000, 45000, 90000, 30)
) as v(name, days, holiday, start_time, end_time, price_standard, price_vip, price_sweetbox, priority)
where not exists (select 1 from price_rules);
update cinemas set lat = 21.0005, lng = 105.8148 where id = 'beta-thanh-xuan' and lat is null;
update cinemas set lat = 10.792, lng = 106.689 where id = 'beta-tran-quang-khai' and lat is null;
update cinemas set lat = 20.985, lng = 105.841 where id = 'beta-giai-phong' and lat is null;
update cinemas set lat = 21.028, lng = 105.772 where id = 'beta-my-dinh' and lat is null;
update cinemas set lat = 10.835, lng = 106.665 where id = 'beta-quang-trung' and lat is null;
update cinemas set lat = 10.806, lng = 106.716 where id = 'beta-ung-van-khiem' and lat is null;
update cinemas set lat = 21.594, lng = 105.848 where id = 'beta-thai-nguyen' and lat is null;
update cinemas set lat = 21.273, lng = 106.194 where id = 'beta-bac-giang' and lat is null;
update cinemas set lat = 12.238, lng = 109.196 where id = 'beta-nha-trang' and lat is null;
insert into posts (id, title, type, summary, body, image, published, pinned) values ('thu-ba-vui-ve', 'Thứ Ba vui vẻ – vé từ 40.000 đ', 'PROMO', 'Mọi suất chiếu thứ Ba hằng tuần: ghế thường 40.000 đ, ghế VIP 45.000 đ, ghế đôi 90.000 đ.', 'Áp dụng cho tất cả suất chiếu vào thứ Ba tại mọi rạp, đặt online hoặc tại quầy.

Giá đã hiển thị sẵn khi bạn chọn suất và chọn ghế; không cần nhập mã.

Có thể dùng kèm vé ưu đãi HSSV / U22, trẻ em, người cao tuổi.', 'images/t3.webp', true, true) on conflict (id) do nothing;
insert into posts (id, title, type, summary, body, image, published, pinned) values ('ve-hssv-u22', 'Vé HSSV / U22 giảm 10.000 đ', 'PROMO', 'Chọn loại vé "HSSV / U22" ở bước chọn ghế, giảm 10.000 đ mỗi vé ghế thường hoặc VIP.', 'Dành cho học sinh, sinh viên hoặc khách dưới 22 tuổi.

Vui lòng mang thẻ học sinh, sinh viên hoặc CCCD để nhân viên kiểm tra khi soát vé. Không áp dụng cho ghế đôi Sweetbox.', 'images/hssv.webp', true, false) on conflict (id) do nothing;
insert into posts (id, title, type, summary, body, image, published, pinned) values ('suat-som-truoc-10h', 'Suất sớm trước 10:00 – vé từ 40.000 đ', 'PROMO', 'Các suất bắt đầu trước 10 giờ sáng có giá thấp hơn ngày thường và cuối tuần.', 'Áp dụng mọi ngày trong tuần cho các suất bắt đầu trước 10:00.

Xem các suất sớm ở trang Lịch chiếu theo rạp.', 'images/phimhayt10-1702x621-1-135337-300926-58.webp', true, false) on conflict (id) do nothing;

commit;
