-- When work_status = 'on_hold', remember the status to resume to. Null otherwise.
-- Consumed by the work-status flow (Plan 4) via domain hold()/resume().
alter table public.invoice_items
  add column if not exists resume_status public.work_status;

comment on column public.invoice_items.resume_status is
  'When work_status = on_hold, the prior status to return to on resume; null otherwise.';
