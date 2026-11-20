-- =====================================================================
-- Đợt 7: nâng cấp giao diện Kế toán / CSKH / Quầy – nhận xử lý phiếu, ghi chú nội bộ, chốt sổ ngày.
-- Chạy MỘT LẦN trong Supabase > SQL Editor (sau 2026-11-28). Chạy lại an toàn.
-- =====================================================================
begin;

-- Phiếu hỗ trợ: nhân viên nhận xử lý + ghi chú nội bộ (khách không thấy)
alter table support_tickets add column if not exists assigned_to uuid;
alter table support_tickets add column if not exists assigned_name text;
alter table support_tickets add column if not exists assigned_at timestamptz;
alter table support_tickets add column if not exists internal_notes jsonb not null default '[]';
create index if not exists tickets_assigned_idx on support_tickets(assigned_to) where status <> 'RESOLVED';

-- Chốt sổ theo ngày của Kế toán: lưu ảnh chụp số liệu lúc chốt để phát hiện phát sinh sau chốt
create table if not exists day_closings (
  id           text primary key,                  -- = date
  date         text unique not null,              -- YYYY-MM-DD (giờ VN)
  summary      jsonb not null,
  note         text,
  closed_by    text,
  closed_by_id uuid,
  closed_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table day_closings enable row level security;

-- Tăng tốc tra cứu cho màn hình Kế toán / Quầy
create index if not exists bank_tx_date_idx on bank_transactions(transaction_date);
create index if not exists orders_showtime_status_idx on orders(showtime_key, status);
create index if not exists ticket_checkins_staff_idx on ticket_checkins(staff_id, created_at);

commit;
