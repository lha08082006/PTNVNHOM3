// tools/gen-catalog-migration.js - Sinh migration bảng danh mục / soát vé / quên mật khẩu
// kèm dữ liệu khởi tạo (phim, rạp, voucher) lấy đúng từ catalog.js.
// Chạy: node tools/gen-catalog-migration.js > migrations/2026-11-21_danh-muc-qr-otp.sql
process.env.DB_MODE = 'mock';
if (require.main === module) console.log = () => {}; // không để log lọt vào file SQL
const CatalogDB = require('../lib/catalog-db');

const q = (v) => v == null ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const { movies, cinemas, vouchers } = CatalogDB.seedRows();

const TABLES = `-- Phim (Quản lý sửa trên admin.html > Danh mục)
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
alter table auth_throttle   enable row level security;`;

const out = [];
out.push('-- =====================================================================');
out.push('-- Giai đoạn C/D/E: danh mục trong database (phim, rạp, suất chiếu, voucher),');
out.push('-- soát vé QR tại quầy, quên mật khẩu bằng mã OTP, chặn dò mật khẩu.');
out.push('-- Sinh tự động bởi tools/gen-catalog-migration.js. Chạy MỘT LẦN trong Supabase > SQL Editor');
out.push('-- (sau 2026-11-20). Chạy lại an toàn. Sau đó vào admin.html > Danh mục để tạo suất chiếu.');
out.push('-- =====================================================================');
out.push('begin;', '', TABLES, '', '-- Dữ liệu khởi tạo (bỏ qua nếu đã có)');
for (const m of movies) out.push(`insert into movies (id, title, short_title, age, meta, poster, format, badge, duration_min, status) values (${[m.id, m.title, m.short_title, m.age, m.meta, m.poster, m.format, m.badge, m.duration_min, m.status].map(q).join(', ')}) on conflict (id) do nothing;`);
for (const c of cinemas) out.push(`insert into cinemas (id, name, city, address, active) values (${[c.id, c.name, c.city, c.address, c.active].map(q).join(', ')}) on conflict (id) do nothing;`);
for (const v of vouchers) out.push(`insert into vouchers (id, discount, label, active) values (${[v.id, v.discount, v.label, v.active].map(q).join(', ')}) on conflict (id) do nothing;`);
out.push('', 'commit;', '');
if (require.main === module) process.stdout.write(out.join('\n'));
module.exports = { TABLES };
