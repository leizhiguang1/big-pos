-- Managed catalog of product units of measure (rendered as "per {label}").
-- Mirrors work_stages / service_statuses (minus color). products.unit stays a
-- text string validated against this list — no foreign key.
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.units enable row level security;

-- Read for any authenticated user; writes gated to the settings.manage permission
-- (same shape as work_stages_read / work_stages_write).
create policy units_read on public.units
  for select to authenticated using (true);
create policy units_write on public.units
  for all to authenticated
  using (auth_has_permission('settings.manage'))
  with check (auth_has_permission('settings.manage'));

-- Seed the current vocabulary (covers every existing product unit: unit/set/arch).
insert into public.units (label, sort_order) values
  ('unit', 10), ('tooth', 20), ('arch', 30), ('quadrant', 40),
  ('case', 50), ('set', 60), ('pair', 70);
