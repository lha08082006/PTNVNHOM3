// tools/gen-dot1-migration.js - Sinh migration Đợt 1 (bảng giá, loại vé, ngày lễ, tin tức & ưu đãi,
// thông tin phim chi tiết, tọa độ rạp) kèm dữ liệu mẫu lấy đúng từ code (DEFAULT_RULES, TICKET_TYPES, bài mẫu).
// Chạy: node tools/gen-dot1-migration.js > migrations/2026-11-22_dot-1-gia-ve-tin-tuc.sql
process.env.DB_MODE = 'mock';
if (require.main === module) console.log = () => {}; // không để log lọt vào file SQL
const Catalog = require('../catalog');
const CatalogDB = require('../lib/catalog-db');
const Posts = require('../lib/posts');

const q = (v) => v == null ? 'null'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : Array.isArray(v) ? `'${JSON.stringify(v)}'::jsonb`
  : `'${String(v).replace(/'/g, "''")}'`;

const TABLES = `-- Loại vé theo đối tượng (giảm vào giá ghế thường / VIP; không áp dụng ghế đôi)
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
alter table posts        enable row level security;`;

function build() {
  const { ticketTypes, priceRules, cinemas } = CatalogDB.seedRows();
  const out = [
    '-- =====================================================================',
    '-- Đợt 1 nâng cấp: loại vé & giá theo ngày/khung giờ, ngày lễ, tin tức & ưu đãi,',
    '-- thông tin phim chi tiết, tọa độ rạp. Sinh bởi tools/gen-dot1-migration.js.',
    '-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-21). Chạy lại an toàn.',
    '-- Giá trong price_rules và bài trong posts là MẪU – Quản lý sửa ở admin.html > Danh mục.',
    '-- =====================================================================',
    'begin;', '', TABLES, '', '-- Dữ liệu mẫu (bỏ qua nếu đã có)'
  ];
  for (const t of ticketTypes) out.push(`insert into ticket_types (id, label, off, note, active, sort) values (${[t.id, t.label, t.off, t.note, true, t.sort].map(q).join(', ')}) on conflict (id) do nothing;`);
  out.push(`insert into price_rules (name, days, holiday, start_time, end_time, price_standard, price_vip, price_sweetbox, priority)
select * from (values`);
  out.push(priceRules.map(r => `  (${[r.name, r.days, r.holiday, r.start_time, r.end_time, r.price_standard, r.price_vip, r.price_sweetbox, r.priority].map(q).join(', ')})`).join(',\n'));
  out.push(`) as v(name, days, holiday, start_time, end_time, price_standard, price_vip, price_sweetbox, priority)
where not exists (select 1 from price_rules);`);
  for (const c of cinemas) if (c.lat != null) out.push(`update cinemas set lat = ${c.lat}, lng = ${c.lng} where id = ${q(c.id)} and lat is null;`);
  for (const p of Posts.SEED) out.push(`insert into posts (id, title, type, summary, body, image, published, pinned) values (${[p.id, p.title, p.type, p.summary, p.body, p.image, true, p.pinned].map(q).join(', ')}) on conflict (id) do nothing;`);
  out.push('', 'commit;', '');
  return out.join('\n');
}

if (require.main === module) process.stdout.write(build());
module.exports = { TABLES, build };
