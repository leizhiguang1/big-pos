-- Central audit trail for Super Admin destructive actions (delete/restore/purge).
-- Written only via the service-role admin client inside requireSuperadmin()-gated
-- server actions; there is intentionally NO client RLS policy, so regular sessions
-- can neither read nor write it. The service-role key bypasses RLS, which is the
-- only path that touches this table.
create table if not exists public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  entity_label text,
  reason       text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

-- Newest-first is the only read pattern (the console Activity feed).
create index if not exists idx_admin_audit_log_created_at
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
-- No policies on purpose: only the service role (admin client) may read/write.
