-- Invoice soft-delete (hidden), distinct from voided_at (visible-but-void).
--   deleted_at NULL      => live invoice (shows in normal lists/reports)
--   deleted_at timestamp => deleted (hidden everywhere; only the Super Admin
--                           Console recycle bin surfaces it for restore/purge)
-- Additive, no backfill: existing invoices stay live. Writes go through the
-- service-role admin client inside requireSuperadmin()-gated actions.
alter table public.invoices
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    uuid,
  add column if not exists delete_reason text;

-- Partial index for the hot "not deleted" path (every normal list/report query).
create index if not exists idx_invoices_not_deleted
  on public.invoices (created_at desc)
  where deleted_at is null;
