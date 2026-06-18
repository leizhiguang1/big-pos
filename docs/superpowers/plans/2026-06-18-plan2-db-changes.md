# Plan 2 — Database Changes (Spec 1, Plan 2 of 4)

> **For agentic workers:** controller-executed (prod-DB operations via the Supabase MCP, not TDD code). Steps use checkbox (`- [ ]`) for tracking.

**Goal:** Make the three additive production-schema changes the foundation needs — a billing-status CHECK, an `on_hold` resume column, and atomic payment RPCs (with the Mark-Paid→payment-row reconciliation) — versioned as migrations and applied to the live DB, then refresh the generated types.

**Architecture:** DB-only. No app code consumes these yet — Plan 3 (invoices) and Plan 4 (work) wire them in. Isolating the prod-schema work keeps it small, fully verifiable via SQL, and easy to confirm before it touches live data.

**Tech Stack:** Postgres (Supabase), Supabase MCP (`apply_migration` history not used — we `execute_sql` + record history to match the file version, per the established pattern), `mcp__supabase__generate_typescript_types`.

## Global Constraints

- **All changes are additive / forward-compatible.** No drops, no column type changes, no data rewrites.
- Existing stored `status` values are only `draft`(1), `sent`(16), `paid`(1). `overdue` is **derived, never stored** — the CHECK deliberately excludes it. Verified no code writes `'overdue'`.
- New functions match existing RPC convention: `language plpgsql`, `set search_path to 'public'`, **not** SECURITY DEFINER.
- Each migration is recorded in `supabase_migrations.schema_migrations` with the file's exact version (same pattern as `20260618000000`), so repo and remote history stay aligned. Do NOT `supabase db push` (history is reconstructed; baseline is unpushed).
- **Prod gate:** the controller confirms each migration's SQL with the user before applying.

---

## Task 1: Billing-status CHECK constraint

**File:** `supabase/migrations/20260618010000_invoice_status_check.sql`

```sql
-- Constrain invoices.status to the stored billing vocabulary.
-- 'overdue' is intentionally excluded: it is derived from due_date at read time, never stored.
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft', 'sent', 'partial', 'paid'));
```

- [ ] **Step 1:** Pre-check existing data still satisfies it: `select status, count(*) from public.invoices group by status;` → only draft/sent/paid (already verified).
- [ ] **Step 2:** Write the migration file above.
- [ ] **Step 3 (confirm-gated):** Apply via MCP `execute_sql` (the `alter table` statement).
- [ ] **Step 4:** Verify: `select conname from pg_constraint where conrelid='public.invoices'::regclass and conname='invoices_status_check';` returns the row.
- [ ] **Step 5:** Record history (`insert into supabase_migrations.schema_migrations(version,name,statements) values('20260618010000','invoice_status_check', array[...]) on conflict do nothing;`).
- [ ] **Step 6:** Commit the migration file.

---

## Task 2: `invoice_items.resume_status` column

**File:** `supabase/migrations/20260618010100_invoice_items_resume_status.sql`

```sql
-- When work_status = 'on_hold', remember the status to resume to. Null otherwise.
alter table public.invoice_items
  add column if not exists resume_status public.work_status;

comment on column public.invoice_items.resume_status is
  'When work_status = on_hold, the prior status to return to on resume; null otherwise.';
```

- [ ] **Step 1:** Write the migration file.
- [ ] **Step 2 (confirm-gated):** Apply via MCP `execute_sql`.
- [ ] **Step 3:** Verify: `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='invoice_items' and column_name='resume_status';` returns one row (`USER-DEFINED`/`work_status`).
- [ ] **Step 4:** Record history (`20260618010100` / `invoice_items_resume_status`).
- [ ] **Step 5:** Commit.

---

## Task 3: Atomic payment RPCs

**File:** `supabase/migrations/20260618010200_payment_rpcs.sql`

```sql
-- Record a payment and atomically advance billing status (replaces the old
-- insert-then-separately-update flow). Never downgrades an already-paid invoice.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_created_by uuid,
  p_payment_date date default current_date,
  p_reference  text default null,
  p_notes      text default null
) returns text
language plpgsql
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_status text;
  v_paid numeric;
  v_new_status text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  insert into payments (invoice_id, amount, payment_date, reference_number, notes, created_by)
  values (p_invoice_id, p_amount, coalesce(p_payment_date, current_date), p_reference, p_notes, p_created_by);

  select total, status into v_total, v_status from invoices where id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice_id;

  v_new_status := case
    when v_status = 'paid' then 'paid'
    when v_paid >= v_total then 'paid'
    else 'partial'
  end;

  update invoices set status = v_new_status where id = p_invoice_id;
  return v_new_status;
end;
$$;

-- Mark an invoice paid, creating a balancing payment for the outstanding amount
-- so sum(payments) always reconciles with the 'paid' status (the money-model fix).
create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_created_by uuid,
  p_reference  text default null
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
begin
  select total into v_total from invoices where id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice_id;
  v_outstanding := greatest(coalesce(v_total,0) - v_paid, 0);

  if v_outstanding > 0 then
    insert into payments (invoice_id, amount, payment_date, reference_number, notes, created_by)
    values (p_invoice_id, v_outstanding, current_date, p_reference, 'Marked as paid', p_created_by);
  end if;

  update invoices set status = 'paid' where id = p_invoice_id;
end;
$$;
```

- [ ] **Step 1:** Write the migration file.
- [ ] **Step 2 (confirm-gated):** Apply via MCP `execute_sql`.
- [ ] **Step 3:** Verify functions exist + signatures: `select proname, pg_get_function_arguments(oid) from pg_proc where proname in ('record_payment','mark_invoice_paid');`.
- [ ] **Step 4:** Functional smoke that DOES NOT persist (prod-safe): run inside a rolled-back transaction —
  ```sql
  do $$
  declare v_id uuid; v_res text;
  begin
    select id into v_id from invoices where status='draft' limit 1;
    perform record_payment(v_id, 1, (select created_by from invoices where id=v_id));
    -- assertions could raise; we always roll back:
    raise exception 'smoke-rollback-ok';
  exception when others then
    if sqlerrm <> 'smoke-rollback-ok' then raise; end if;
  end $$;
  ```
  (Confirms it executes against real columns without error; rolls back so no payment persists.)
- [ ] **Step 5:** Record history (`20260618010200` / `payment_rpcs`).
- [ ] **Step 6:** Commit.

---

## Task 4: Regenerate types + update docs

**Files:** `src/lib/database-generated.types.ts` (regenerate), `docs/modules/data-model.md` (update).

- [ ] **Step 1:** Regenerate types via MCP `generate_typescript_types`; overwrite `src/lib/database-generated.types.ts`. Confirm it now includes `invoice_items.resume_status` and the two new functions.
- [ ] **Step 2:** `npx tsc --noEmit` → exit 0 (the convenience layer in `database.types.ts` still compiles).
- [ ] **Step 3:** `npx vitest run` → 88 pass (no behavior change) and `npm run lint` → 0.
- [ ] **Step 4:** Update `docs/modules/data-model.md`: note the `status` CHECK (and that `overdue` is derived-only), the `resume_status` column, and the two new RPCs in the functions table.
- [ ] **Step 5:** Commit (types + docs).

---

## Success criteria
- `invoices_status_check` exists; all rows satisfy it; writing `'overdue'` is rejected, `'partial'`/`'paid'` accepted.
- `invoice_items.resume_status` column exists (nullable `work_status`).
- `record_payment` and `mark_invoice_paid` exist, search_path-pinned, and execute against real data in a rolled-back smoke.
- Generated types include the new column + functions; tsc/lint/tests green.
- Three migration files committed and recorded in remote history with matching versions.

## Not in this plan (later)
- Consuming the RPCs / column from the UI — Plan 3 (invoices) and Plan 4 (work) wire them via the `src/data/` layer + server actions and add the E2E flows.
