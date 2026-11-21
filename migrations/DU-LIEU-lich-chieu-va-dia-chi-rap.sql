-- =====================================================================
-- DỮ LIỆU MẪU: lịch chiếu 14 ngày tới + địa chỉ 9 rạp – dán TOÀN BỘ và chạy trong Supabase > SQL Editor.
-- KHÔNG phải migration cấu trúc: chỉ thêm dữ liệu, không xóa / sửa gì đã có.
--   - Địa chỉ: chỉ điền cho rạp đang để trống (rạp nào Quản lý đã nhập thì giữ nguyên).
--   - Suất chiếu: chỉ tạo cho rạp CHƯA có suất nào sắp tới (rạp đã có lịch thì giữ nguyên).
--     Mỗi rạp 6 phim đang chiếu (lệch nhau giữa các rạp), mỗi phim 3 suất / ngày, mỗi phim một phòng;
--     giá theo bảng giá chung (Admin > Danh mục > Bảng giá). Suất đã qua giờ không tạo.
--   - Chạy lại bao nhiêu lần cũng an toàn: suất đã có (cùng rạp, phim, giờ) được bỏ qua.
-- Sau đó việc chạy hằng đêm (/api/cron) tự gia hạn lịch: chép lịch tuần trước sang ngày còn trống, giữ đủ 14 ngày.
-- KẾT QUẢ: cuối file in bảng số suất sắp tới của từng rạp.
-- =====================================================================
begin;

-- 1) Địa chỉ rạp (lấy từ dữ liệu sẵn có của web)
update cinemas c set address = v.addr
from (values
  ('beta-thanh-xuan',      'Tầng B1, Golden West, Lê Văn Thiêm, Q. Thanh Xuân'),
  ('beta-tran-quang-khai', 'Tầng 2, 130 Trần Quang Khải, Q.1'),
  ('beta-giai-phong',      'Tầng 3, Imperial Plaza, 360 Giải Phóng, Q. Hoàng Mai'),
  ('beta-my-dinh',         'Tầng hầm B1, Tòa nhà Golden Palace, Mễ Trì, Q. Nam Từ Liêm'),
  ('beta-quang-trung',     '645 Quang Trung, P.11, Q. Gò Vấp'),
  ('beta-ung-van-khiem',   'Tòa nhà D2, 60 Ung Văn Khiêm, P.25, Q. Bình Thạnh'),
  ('beta-thai-nguyen',     'Tầng 4, TTTM Phổ Yên Plaza, Thái Nguyên'),
  ('beta-bac-giang',       'Tầng 4, Tòa nhà Hapro, Quảng Trường 3/2, Bắc Giang'),
  ('beta-nha-trang',       'Tầng 4, TTTM Nha Trang Center, 20 Trần Phú')
) as v(id, addr)
where c.id = v.id and coalesce(trim(c.address), '') = '';

-- 2) Suất chiếu 14 ngày tới (giờ Việt Nam)
with mv as (
  select id, coalesce(nullif(badge, ''), '2D') as fmt,
         (row_number() over (order by created_at, id) - 1)::int as i, (count(*) over ())::int as n
  from movies where status = 'NOW'
), cn as (
  select id, (row_number() over (order by created_at, id) - 1)::int as ci
  from cinemas c
  where active is not false
    and not exists (select 1 from showtimes s where s.cinema_id = c.id and s.starts_at > now())
), slot(si, t) as (
  values (0, time '09:30'), (1, time '12:15'), (2, time '14:45'), (3, time '17:00'), (4, time '19:30'), (5, time '21:15'), (6, time '22:45')
), plan as (
  select cn.id as cinema_id, mv.id as movie_id, mv.fmt, k, s, d,
         ((now() at time zone 'Asia/Ho_Chi_Minh')::date + d) as day
  from cn
  cross join generate_series(0, 5) as k
  cross join generate_series(0, 2) as s
  cross join generate_series(0, 13) as d
  join mv on mv.i = (cn.ci + k) % mv.n
), rows as (
  select distinct p.cinema_id, p.movie_id, p.fmt, p.k,
         ((p.day + slot.t) at time zone 'Asia/Ho_Chi_Minh') as starts_at
  from plan p
  join slot on slot.si = (p.k + p.s * 2 + p.d) % 7
)
insert into showtimes (movie_id, cinema_id, starts_at, format, room, active)
select r.movie_id, r.cinema_id, r.starts_at, r.fmt, 'Phòng 0' || (r.k + 1), true
from rows r
where r.starts_at > now()
  and not exists (select 1 from showtimes x where x.cinema_id = r.cinema_id and x.movie_id = r.movie_id and x.starts_at = r.starts_at);

commit;

-- Kết quả: số suất sắp tới của từng rạp (mỗi rạp mới tạo khoảng 240–250 suất)
select c.name as "Rạp", c.address as "Địa chỉ",
       count(s.id) filter (where s.starts_at > now()) as "Suất sắp tới",
       to_char(max(s.starts_at) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as "Lịch tới ngày"
from cinemas c
left join showtimes s on s.cinema_id = c.id and s.active is not false
where c.active is not false
group by c.id, c.name, c.address, c.created_at
order by c.created_at, c.id;
