-- =====================================================================
-- Giai đoạn C/D/E: danh mục trong database (phim, rạp, suất chiếu, voucher),
-- soát vé QR tại quầy, quên mật khẩu bằng mã OTP, chặn dò mật khẩu.
-- Sinh tự động bởi tools/gen-catalog-migration.js. Chạy MỘT LẦN trong Supabase > SQL Editor
-- (sau 2026-11-20). Chạy lại an toàn. Sau đó vào admin.html > Danh mục để tạo suất chiếu.
-- =====================================================================
begin;

-- Phim (Quản lý sửa trên admin.html > Danh mục)
create table if not exists movies (
  id           text primary key,                  -- mã phim, vd: suzume
  title        text not null,
  short_title  text,
  age          text,
  meta         text,
  poster       text,
  format       text,
  badge        text,
  duration_min int,
  trailer      text,
  status       text not null default 'NOW' check (status in ('NOW','SOON','HIDDEN')),
  created_at   timestamptz not null default now()
);

-- Cụm rạp
create table if not exists cinemas (
  id         text primary key,                    -- vd: beta-thanh-xuan
  name       text not null,
  city       text,
  address    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Suất chiếu: giá ghế để null = dùng giá mặc định trong catalog.js
create table if not exists showtimes (
  id             uuid primary key default gen_random_uuid(),
  movie_id       text not null references movies(id),
  cinema_id      text not null references cinemas(id),
  starts_at      timestamptz not null,
  format         text,
  room           text,
  price_standard bigint,
  price_vip      bigint,
  price_sweetbox bigint,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (movie_id, cinema_id, starts_at)
);
create index if not exists showtimes_cinema_time_idx on showtimes(cinema_id, starts_at);
create index if not exists showtimes_movie_time_idx on showtimes(movie_id, starts_at);

-- Voucher: giới hạn tổng lượt, lượt mỗi khách, thời hạn
create table if not exists vouchers (
  id           text primary key,                  -- mã voucher (chữ in hoa)
  discount     bigint not null check (discount > 0),
  label        text,
  max_uses     int,
  per_customer int,
  starts_at    timestamptz,
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists orders_voucher_idx on orders(voucher);

-- Soát vé tại quầy: mỗi đơn chỉ soát một lần (unique order_id)
create table if not exists ticket_checkins (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references orders(id),
  order_code text,
  staff_id   uuid references staff(id),
  staff_name text,
  method     text,                                -- QR | CODE
  created_at timestamptz not null default now()
);

-- Quên mật khẩu: mã 6 số (lưu dạng băm), hết hạn 15 phút
create table if not exists password_resets (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Chặn dò mật khẩu: đếm lần sai theo tài khoản
create table if not exists auth_throttle (
  id           text primary key,                  -- c:<email/sđt> | s:<email nhân viên> | f:/r:<email>
  fails        int not null default 0,
  window_start timestamptz,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

alter table movies          enable row level security;
alter table cinemas         enable row level security;
alter table showtimes       enable row level security;
alter table vouchers        enable row level security;
alter table ticket_checkins enable row level security;
alter table password_resets enable row level security;
alter table auth_throttle   enable row level security;

-- Dữ liệu khởi tạo (bỏ qua nếu đã có)
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('an-mang-karaoke', 'ÁN MẠNG KARAOKE', 'Án Mạng Karaoke', 'T16', 'Trinh thám, Hài hước, Bí ẩn · 96 phút · Tiếng Việt - Phụ đề Tiếng Anh', 'images/an-mang-karaoke-kc-30-10-2026-kt-chuan-114723-300926-76.jpg', '2D Phụ đề Tiếng Anh', '2D PHỤ ĐỀ', 96, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('linh-gioi-dai-chien', 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ', 'Linh Giới Đại Chiến', 'T18', 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt', 'images/400x633-145627-230926-40.jpg', '2D Phụ đề Tiếng Việt', '2D PHỤ ĐỀ', 128, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('quy-an-tang-4', 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI', 'Quỷ Ăn Tạng 4', 'T18', 'Kinh dị, Bí ẩn, Giật gân · 115 phút · Tiếng Thái - Phụ đề Tiếng Việt', 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.jpg', '2D Phụ đề Tiếng Việt', '2D PHỤ ĐỀ', 115, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('trai-buon-nguoi', 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI', 'Trại Buôn Người', 'T16', 'Tâm lý, Tội phạm, Gay cấn · 118 phút · Tiếng Việt - Phụ đề Tiếng Anh', 'images/media_images_2026_09_15_official-poster-trai-buon-nguoi-final-142318-150926-62.jpg', '2D Phụ đề Tiếng Anh', '2D PHỤ ĐỀ', 118, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('blue-lock', 'BLUE LOCK: THE MOVIE - EPISODE NAGI', 'Blue Lock: Episode Nagi', 'P', 'Hoạt hình, Thể thao, Anime · 95 phút · Tiếng Nhật - Phụ đề Tiếng Việt', 'images/media_images_2026_09_28_091026-blue-lock-170502-280926-25.jpg', '2D Phụ đề Tiếng Việt', '2D PHỤ ĐỀ', 95, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('ut-lan-2', 'ÚT LAN 2', 'Út Lan 2', 'T16', 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh', 'images/ul2-main-dam-hoi-digital-094550-140926-42.jpg', '2D Phụ đề Tiếng Anh', '2D PHỤ ĐỀ', 114, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('suzume', 'KHÓA CHẶT CỬA NÀO SUZUME', 'Suzume No Tojimari', 'P', 'Hoạt hình, Giả tưởng, Anime · 121 phút · Tiếng Nhật - Phụ đề Tiếng Việt', 'images/poster-khoa-chat-cua-nao-suzum-1-092028-280926-82.jpg', '2D Phụ đề Tiếng Việt', '2D PHỤ ĐỀ', 121, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('ca-voi-nuot-chung', 'CÁ VOI NUỐT CHỬNG', 'Cá Voi Nuốt Chửng', 'T13', 'Sinh tồn, Hành động, Viễn tưởng · 98 phút · Tiếng Anh - Phụ đề Tiếng Việt', 'images/media_images_2026_09_21_ca-voi-nuot-chung-091717-210926-56.jpg', '2D Phụ đề Tiếng Việt', '2D PHỤ ĐỀ', 98, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('me-min', 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI', 'Mẹ Mìn', 'T18', 'Kinh dị, Tâm lý, Giật gân · 105 phút · Tiếng Việt - Phụ đề Tiếng Anh', 'images/me-min-teaser-poster-dkkc-23102026-132757-170926-76.jpg', '2D Phụ đề Tiếng Anh', '2D PHỤ ĐỀ', 105, 'NOW') on conflict (id) do nothing;
insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values ('shaun-the-sheep', 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH', 'Shaun The Sheep', 'P', 'Hoạt hình, Phiêu lưu, Hài hước · 86 phút · Không thoại - Bản quyền Aardman', 'images/media_images_2026_10_05_161026-shaun-the-sheep-152403-051026-14.jpg', '2D Lồng Tiếng', '2D LỒNG TIẾNG', 86, 'NOW') on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-thanh-xuan', 'Beta Thanh Xuân', 'Hà Nội', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-tran-quang-khai', 'Beta Trần Quang Khải', 'TP.HCM', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-giai-phong', 'Beta Giải Phóng', 'Hà Nội', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-my-dinh', 'Beta Mỹ Đình', 'Hà Nội', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-quang-trung', 'Beta Quang Trung', 'TP.HCM', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-ung-van-khiem', 'Beta Ung Văn Khiêm', 'TP.HCM', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-thai-nguyen', 'Beta Thái Nguyên', 'Thái Nguyên', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-bac-giang', 'Beta Bắc Giang', 'Bắc Giang', '', true) on conflict (id) do nothing;
insert into cinemas (id, name, city, address, active) values ('beta-nha-trang', 'Beta Nha Trang', 'Nha Trang', '', true) on conflict (id) do nothing;
insert into vouchers (id, discount, label, active) values ('BETAVIP', 20000, 'Giảm 20.000 đ cho thành viên', true) on conflict (id) do nothing;
insert into vouchers (id, discount, label, active) values ('ALPHA', 20000, 'Giảm 20.000 đ', true) on conflict (id) do nothing;
insert into vouchers (id, discount, label, active) values ('CINEMA', 20000, 'Giảm 20.000 đ', true) on conflict (id) do nothing;

commit;
