-- Configurable display for the fixed production workflow statuses.
--
-- `invoice_items.work_status` remains the stable enum/process backbone. This
-- table only customizes the label/color shown in UI, so transitions, history,
-- resume-from-hold, and reports keep the same semantics.
create table if not exists public.work_status_configs (
  status public.work_status primary key,
  label text not null,
  color text,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

alter table public.work_status_configs enable row level security;

create policy work_status_configs_read on public.work_status_configs
  for select to authenticated using (true);

create policy work_status_configs_update on public.work_status_configs
  for update to authenticated
  using (public.auth_has_permission('settings.manage'))
  with check (public.auth_has_permission('settings.manage'));

-- Seed every existing enum value. Do not overwrite later customizations.
insert into public.work_status_configs (status, label, color, sort_order) values
  ('received',    'Received',    'bg-gray-100 text-gray-700',                            10),
  ('in_progress', 'In Progress', 'bg-blue-100 text-blue-700',                            20),
  ('ready',       'Ready',       'bg-green-100 text-green-700',                          30),
  ('delivered',   'Delivered',   'bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200', 40),
  ('on_hold',     'On Hold',     'bg-orange-100 text-orange-700',                        50)
on conflict (status) do nothing;
