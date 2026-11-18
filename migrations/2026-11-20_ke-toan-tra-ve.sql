-- =====================================================================
-- Hoàn tiền thủ công: Kế toán kiểm tra lại, không đạt thì TRẢ VỀ nhân viên (ACC_RETURNED).
-- Chạy MỘT LẦN trong Supabase > SQL Editor trước khi deploy code mới. Chạy lại an toàn.
-- =====================================================================
begin;

alter table refunds drop constraint if exists refunds_status_check;
alter table refunds add constraint refunds_status_check check (status in (
  'REQUESTED','RETRYING','DONE','MANUAL_REVIEW','FORM_SUBMITTED','CS_APPROVED','ACC_RETURNED','PAID_OUT'));

alter table refunds
  add column if not exists acc_note        text,
  add column if not exists acc_returned_at timestamptz,
  add column if not exists returned_count  int not null default 0,
  add column if not exists review_log      jsonb not null default '[]';

commit;
