# Super Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the built-in Super Admin a self-service console to delete/restore/purge records and reach data the normal UI hides — no DB access required — with every destructive action audited.

**Architecture:** A new `/settings/admin` area gated by `requireSuperadmin()`. Invoices gain a `deleted_at` soft-delete (distinct from `voided_at`); clinics reuse their existing `archived_at`. A central `admin_audit_log` table records every destructive action via a shared `writeAuditLog()` helper. Server actions follow the existing `'use server'` + `createAdminClient()` + `revalidatePath()` + `ActionResult` pattern, all gated to Super Admin.

**Tech Stack:** Next.js (App Router, server components + server actions), Supabase (Postgres + RLS, service-role admin client), TypeScript (`strict:false`), Vitest (`npm test`), integration suite (`npm run test:integration`).

## Global Constraints

- UI always says **"Clinic"**; code/DB/routes/types/permission keys stay `customer` (`docs/CONVENTIONS.md`).
- Dev server runs on **http://localhost:6060** (`npm run dev`).
- Under `strict:false`, narrow with `gate.ok === false` (NOT `!gate.ok`) in new code.
- All mutations use `createAdminClient()` (service role) and gate with `requireSuperadmin()` from `@/lib/auth/require-permission`, which returns `{ ok: true; userId } | { ok: false; error }`.
- `ActionResult = { ok: true } | { ok: false; error: string }`.
- Permission UI is **hide-not-show**: non-superadmins never see the console nav entry or buttons.
- Commit after every task. Branch: `feat/superadmin-console`.

---

## File Structure

- `supabase/migrations/<ts>_invoice_soft_delete.sql` — NEW: `deleted_at/deleted_by/delete_reason` on invoices + partial index.
- `supabase/migrations/<ts>_admin_audit_log.sql` — NEW: audit table + RLS.
- `supabase/migrations/<ts>_invoice_restore_trigger_v2.sql` — NEW: allow Super-Admin void-restore.
- `src/lib/audit/audit-log.ts` — NEW: `writeAuditLog()` helper.
- `src/lib/admin/admin-actions.ts` — NEW: all Super Admin destructive actions.
- `src/data/admin.ts` — NEW: console read queries (deleted invoices, archived clinics, audit feed, dependency counts).
- `src/app/(authenticated)/settings/admin/page.tsx` — NEW: server component, `requireSuperadmin()` gate + data load.
- `src/app/(authenticated)/settings/admin/AdminConsoleClient.tsx` — NEW: tabbed client UI.
- `src/domain/navigation.ts` — MODIFY: add Admin Console nav entry (superadmin-only).
- `src/data/invoices.ts` — MODIFY: add `deleted_at IS NULL` to list reads (76, 128, 198) + by-id detail (216/288).
- `src/data/dashboard.ts`, `src/data/reports.ts`, `src/data/work.ts`, `src/data/customers.ts` — MODIFY: filter `deleted_at` on invoice reads.
- `src/components/employees/EmployeesManager.tsx` — MODIFY: filter `is_system` roles from the assignment dropdown.
- Tests under `src/integration/` and `src/domain/` as specified per task.

---

## Task 1: Super Admin governance lockdown (employee dropdown)

**Files:**
- Modify: `src/components/employees/EmployeesManager.tsx:280-284` (role `<SelectItem>` map) and the roles fetch (`:46`).
- Test: `src/components/employees/employee-role-filter.test.ts` (Create)

**Interfaces:**
- Produces: nothing consumed downstream; pure UI hardening.

- [ ] **Step 1: Write the failing test** — a pure helper `selectableRoles(roles)` that drops `is_system`.

```ts
// src/components/employees/employee-role-filter.test.ts
import { describe, it, expect } from 'vitest'
import { selectableRoles } from './role-filter'

describe('selectableRoles', () => {
  it('excludes system (Super Admin) roles from assignment', () => {
    const roles = [
      { id: '1', name: 'Super Admin', is_system: true },
      { id: '2', name: 'Front Desk', is_system: false },
    ]
    expect(selectableRoles(roles).map(r => r.id)).toEqual(['2'])
  })
  it('keeps a role already assigned even if system, so the current value still renders', () => {
    const roles = [{ id: '1', name: 'Super Admin', is_system: true }]
    expect(selectableRoles(roles, '1').map(r => r.id)).toEqual(['1'])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/components/employees/employee-role-filter.test.ts`
Expected: FAIL — `role-filter` module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/components/employees/role-filter.ts
export interface SelectableRole { id: string; name: string; is_system: boolean }

// Hide Super Admin (system) roles so no one can promote a person to Super Admin
// via the UI — that stays a code/DB-only action. The currentRoleId escape hatch
// keeps an already-assigned system role visible so the editor renders its value.
export function selectableRoles<T extends SelectableRole>(roles: T[], currentRoleId?: string): T[] {
  return roles.filter(r => !r.is_system || r.id === currentRoleId)
}
```

- [ ] **Step 4: Wire it into EmployeesManager** — wrap the dropdown source.

In `EmployeesManager.tsx`, where the role `<SelectItem>`s render (~line 280), replace `roles.map(...)` with `selectableRoles(roles, editing?.role_id).map(...)`. Import `selectableRoles` from `./role-filter`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/employees/employee-role-filter.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/employees/role-filter.ts src/components/employees/employee-role-filter.test.ts src/components/employees/EmployeesManager.tsx
git commit -m "feat(admin): lock Super Admin assignment out of the UI"
```

---

## Task 2: `admin_audit_log` table migration

**Files:**
- Create: `supabase/migrations/<ts>_admin_audit_log.sql`

**Interfaces:**
- Produces: table `public.admin_audit_log(id, actor_id, action, entity_type, entity_id, entity_label, reason, metadata, created_at)` consumed by Task 3 (`writeAuditLog`) and Task 9 (read feed).

- [ ] **Step 1: Write the migration** (timestamp must sort AFTER `20260624120000`)

```sql
-- supabase/migrations/20260625090000_admin_audit_log.sql
-- Central audit trail for Super Admin destructive actions. Written only via the
-- service-role admin client inside requireSuperadmin()-gated actions; no client
-- RLS grant (consistent with how admin actions run). Readable by service role.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_created_at
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
-- No policies: only the service-role key (admin client) can read/write, which is
-- exactly the path Super Admin actions use. Regular sessions get nothing.
```

- [ ] **Step 2: Apply locally / push** — per project Supabase workflow (`supabase db push` or MCP apply_migration). Verify the table exists.

Run: `supabase migration list` (or MCP `list_migrations`)
Expected: the new migration shows as applied.

- [ ] **Step 3: Regenerate DB types** (see memory `supabase-types-workflow`)

Run the project's type-gen command so `admin_audit_log` appears in `src/lib/database-generated.types.ts`.
Expected: `admin_audit_log` present in generated types.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625090000_admin_audit_log.sql src/lib/database-generated.types.ts
git commit -m "feat(admin): add admin_audit_log table"
```

---

## Task 3: `writeAuditLog()` helper

**Files:**
- Create: `src/lib/audit/audit-log.ts`
- Test: `src/lib/audit/audit-log.test.ts`

**Interfaces:**
- Consumes: `admin_audit_log` table (Task 2), `createAdminClient` from `@/lib/supabase/admin`.
- Produces: `writeAuditLog(entry: AuditEntry): Promise<void>` and `type AuditEntry`, consumed by every action in Tasks 5–8.

- [ ] **Step 1: Write the failing test** (helper builds the row shape; DB call mocked)

```ts
// src/lib/audit/audit-log.test.ts
import { describe, it, expect, vi } from 'vitest'

const insert = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}))

import { writeAuditLog } from './audit-log'

describe('writeAuditLog', () => {
  it('inserts a normalized audit row', async () => {
    await writeAuditLog({
      actorId: 'u1', action: 'invoice.purge', entityType: 'invoice',
      entityId: 'i1', entityLabel: 'INV-1042', reason: 'duplicate',
      metadata: { total: 50 },
    })
    expect(insert).toHaveBeenCalledWith({
      actor_id: 'u1', action: 'invoice.purge', entity_type: 'invoice',
      entity_id: 'i1', entity_label: 'INV-1042', reason: 'duplicate',
      metadata: { total: 50 },
    })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/audit/audit-log.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/audit/audit-log.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logServerError } from '@/lib/log'

export type AuditAction =
  | 'invoice.soft_delete' | 'invoice.restore' | 'invoice.purge' | 'invoice.void_restore'
  | 'customer.purge'
  | 'payment.delete' | 'credit.delete'
  | 'product.delete' | 'employee.delete'

export interface AuditEntry {
  actorId: string
  action: AuditAction
  entityType: string
  entityId?: string | null
  entityLabel?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

// Best-effort audit write. Never throws — a failed audit insert must not abort the
// (already-successful or in-flight) admin action; it is logged instead.
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('admin_audit_log').insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
    })
    if (error) logServerError('writeAuditLog', error, { action: entry.action })
  } catch (e) {
    logServerError('writeAuditLog', e, { action: entry.action })
  }
}
```

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run src/lib/audit/audit-log.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/audit-log.ts src/lib/audit/audit-log.test.ts
git commit -m "feat(admin): add writeAuditLog helper"
```

---

## Task 4: Invoice soft-delete columns + restore-trigger v2

**Files:**
- Create: `supabase/migrations/20260625090100_invoice_soft_delete.sql`
- Create: `supabase/migrations/20260625090200_invoice_restore_trigger_v2.sql`

**Interfaces:**
- Produces: `invoices.deleted_at/deleted_by/delete_reason` (consumed by Tasks 5, 10) and a restore-trigger that permits clearing `voided_at` (consumed by Task 5's `restoreVoidedInvoiceAction`).

- [ ] **Step 1: Soft-delete columns migration**

```sql
-- supabase/migrations/20260625090100_invoice_soft_delete.sql
-- Invoice soft-delete (hidden), distinct from voided_at (visible-but-void).
-- NULL = live; a timestamp = deleted (hidden from all normal lists/reports).
alter table public.invoices
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid,
  add column if not exists delete_reason text;

create index if not exists idx_invoices_not_deleted
  on public.invoices (created_at desc)
  where deleted_at is null;
```

- [ ] **Step 2: Restore-trigger v2** — allow void-restore while still blocking accidental clears from non-admin update paths. Strategy: gate on a transaction-local GUC the admin action sets.

```sql
-- supabase/migrations/20260625090200_invoice_restore_trigger_v2.sql
-- Allow a Super-Admin void-restore (clearing voided_at) ONLY when the action sets
-- the transaction-local flag app.allow_invoice_restore = 'on'. All other update
-- paths still hit the original block, preserving the "voided is terminal" rule.
create or replace function public.prevent_invoice_restore()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is not null and new.voided_at is null then
    if coalesce(current_setting('app.allow_invoice_restore', true), 'off') <> 'on' then
      raise exception 'Voided invoices cannot be restored'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
-- Trigger definition unchanged (still BEFORE UPDATE OF voided_at).
```

- [ ] **Step 3: Apply + regen types**

Run: apply both migrations (project Supabase workflow), then regenerate types.
Expected: `deleted_at` present on invoices in generated types; migrations listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625090100_invoice_soft_delete.sql supabase/migrations/20260625090200_invoice_restore_trigger_v2.sql src/lib/database-generated.types.ts
git commit -m "feat(admin): invoice soft-delete columns + restore-trigger v2"
```

---

## Task 5: Invoice admin actions (soft-delete, restore, restore-from-void, purge)

**Files:**
- Create: `src/lib/admin/admin-actions.ts`
- Test: `src/integration/admin-invoice-actions.integration.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin`, `createAdminClient`, `writeAuditLog` (Task 3), invoice columns (Task 4).
- Produces (consumed by Task 8 UI):
  - `softDeleteInvoiceAction(input:{id:string; reason?:string}): Promise<ActionResult>`
  - `restoreInvoiceAction(id:string): Promise<ActionResult>`
  - `restoreVoidedInvoiceAction(input:{id:string; reason?:string}): Promise<ActionResult>`
  - `purgeInvoiceAction(input:{id:string; reason?:string}): Promise<ActionResult>`

- [ ] **Step 1: Write integration tests** (mirror `src/integration/archive-clinics.integration.test.ts` setup/harness).

```ts
// src/integration/admin-invoice-actions.integration.test.ts
// Uses the project's integration harness (service-role client + seeded fixtures),
// same as archive-clinics.integration.test.ts.
import { describe, it, expect } from 'vitest'
// import { /* harness helpers */ } from './helpers'  // match archive-clinics imports

describe('invoice admin actions', () => {
  it('soft-delete hides the invoice from getInvoicesPage and stamps deleted_at', async () => {
    // seed a live invoice -> softDeleteInvoiceAction -> expect deleted_at set,
    // and getInvoicesPage({view:'all'}) does not include it.
  })
  it('restore clears deleted_at and the invoice reappears', async () => {})
  it('restoreVoidedInvoiceAction clears voided_at via the GUC flag', async () => {})
  it('purge removes the invoice and cascades items + payments', async () => {})
  it('every action writes an admin_audit_log row with the right action', async () => {})
})
```

Fill the test bodies against the harness used by `archive-clinics.integration.test.ts` (read that file first for the exact seed/login helpers).

- [ ] **Step 2: Run, verify fail**

Run: `npm run test:integration -- admin-invoice-actions`
Expected: FAIL — actions not implemented.

- [ ] **Step 3: Implement the actions**

```ts
// src/lib/admin/admin-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import { writeAuditLog } from '@/lib/audit/audit-log'
import { logServerError } from '@/lib/log'

export type ActionResult = { ok: true } | { ok: false; error: string }

function revalidateInvoiceViews(id: string) {
  revalidatePath('/invoices'); revalidatePath(`/invoices/${id}`)
  revalidatePath('/dashboard'); revalidatePath('/settings/admin')
}

export async function softDeleteInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
  const { error } = await admin.from('invoices').update({
    deleted_at: new Date().toISOString(), deleted_by: gate.userId, delete_reason: input.reason?.trim() || null,
  }).eq('id', input.id)
  if (error) { logServerError('softDeleteInvoiceAction', error, { id: input.id }); return { ok: false, error: 'Could not delete the invoice.' } }
  await writeAuditLog({ actorId: gate.userId, action: 'invoice.soft_delete', entityType: 'invoice', entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}

export async function restoreInvoiceAction(id: string): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', id).single()
  const { error } = await admin.from('invoices').update({ deleted_at: null, deleted_by: null, delete_reason: null }).eq('id', id)
  if (error) { logServerError('restoreInvoiceAction', error, { id }); return { ok: false, error: 'Could not restore the invoice.' } }
  await writeAuditLog({ actorId: gate.userId, action: 'invoice.restore', entityType: 'invoice', entityId: id, entityLabel: inv?.invoice_number ?? null })
  revalidateInvoiceViews(id)
  return { ok: true }
}

// Void-restore needs the GUC flag the trigger checks. Use an RPC or a raw SQL set
// within the same connection. Implement via a SECURITY DEFINER rpc `admin_restore_void(p_id uuid)`
// added in Task 4 migration OR set_config in a single statement. (See note below.)
export async function restoreVoidedInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
  const { error } = await admin.rpc('admin_restore_void', { p_id: input.id })
  if (error) { logServerError('restoreVoidedInvoiceAction', error, { id: input.id }); return { ok: false, error: 'Could not restore the voided invoice.' } }
  await writeAuditLog({ actorId: gate.userId, action: 'invoice.void_restore', entityType: 'invoice', entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}

export async function purgeInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('*').eq('id', input.id).single()
  // payments + invoice_items cascade via ON DELETE CASCADE.
  const { error } = await admin.from('invoices').delete().eq('id', input.id)
  if (error) { logServerError('purgeInvoiceAction', error, { id: input.id }); return { ok: false, error: 'Could not permanently delete the invoice.' } }
  await writeAuditLog({ actorId: gate.userId, action: 'invoice.purge', entityType: 'invoice', entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason, metadata: inv ?? null })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}
```

**Note for Step 3:** add the `admin_restore_void` RPC to the Task 4 trigger migration:

```sql
create or replace function public.admin_restore_void(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_invoice_restore', 'on', true);
  update public.invoices set voided_at = null, voided_by = null, void_reason = null where id = p_id;
end; $$;
revoke all on function public.admin_restore_void(uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run integration tests**

Run: `npm run test:integration -- admin-invoice-actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/admin-actions.ts src/integration/admin-invoice-actions.integration.test.ts supabase/migrations/20260625090200_invoice_restore_trigger_v2.sql src/lib/database-generated.types.ts
git commit -m "feat(admin): invoice soft-delete/restore/void-restore/purge actions"
```

---

## Task 6: Clinic purge action (dependency-aware)

**Files:**
- Modify: `src/lib/admin/admin-actions.ts` (append)
- Test: `src/integration/admin-clinic-purge.integration.test.ts`

**Interfaces:**
- Consumes: `customers.archived_at`, FK from invoices/credits.
- Produces: `purgeCustomerAction(input:{id:string; reason?:string}): Promise<ActionResult>` (consumed by Task 8).

- [ ] **Step 1: Write integration test**

```ts
// src/integration/admin-clinic-purge.integration.test.ts
describe('purgeCustomerAction', () => {
  it('refuses to purge a clinic that still has invoices', async () => {
    // seed clinic + 1 invoice -> purge -> expect { ok:false } mentioning invoices.
  })
  it('refuses to purge a clinic that still has credits', async () => {})
  it('purges an archived clinic with no dependents and audits it', async () => {})
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm run test:integration -- admin-clinic-purge`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `admin-actions.ts`)

```ts
export async function purgeCustomerAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate
  const admin = createAdminClient()
  const [{ count: invCount }, { count: creditCount }] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', input.id),
    admin.from('credits').select('id', { count: 'exact', head: true }).eq('customer_id', input.id),
  ])
  if ((invCount ?? 0) > 0 || (creditCount ?? 0) > 0) {
    return { ok: false, error: `Clinic still has ${invCount ?? 0} invoice(s) and ${creditCount ?? 0} credit(s). Delete or reassign those first.` }
  }
  const { data: c } = await admin.from('customers').select('clinic_name').eq('id', input.id).single()
  const { error } = await admin.from('customers').delete().eq('id', input.id)
  if (error) { logServerError('purgeCustomerAction', error, { id: input.id }); return { ok: false, error: 'Could not permanently delete the clinic.' } }
  await writeAuditLog({ actorId: gate.userId, action: 'customer.purge', entityType: 'customer', entityId: input.id, entityLabel: c?.clinic_name ?? null, reason: input.reason })
  revalidatePath('/customers'); revalidatePath('/settings/admin')
  return { ok: true }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm run test:integration -- admin-clinic-purge`
Expected: PASS.

```bash
git add src/lib/admin/admin-actions.ts src/integration/admin-clinic-purge.integration.test.ts
git commit -m "feat(admin): dependency-aware clinic purge action"
```

---

## Task 7: Console read queries

**Files:**
- Create: `src/data/admin.ts`
- Test: `src/integration/admin-reads.integration.test.ts`

**Interfaces:**
- Produces (consumed by Task 8):
  - `getDeletedInvoices(): Promise<DeletedInvoiceRow[]>`
  - `getArchivedClinics(): Promise<ArchivedClinicRow[]>`
  - `getAuditFeed(limit?: number): Promise<AuditRow[]>`
  - `getClinicDependencyCounts(id:string): Promise<{ invoices:number; credits:number }>`

- [ ] **Step 1: Write integration test** asserting `getDeletedInvoices` returns only `deleted_at IS NOT NULL` rows and `getAuditFeed` returns newest-first.

- [ ] **Step 2: Run, verify fail.** Run: `npm run test:integration -- admin-reads`. Expected FAIL.

- [ ] **Step 3: Implement** (uses admin client — these reads are Super-Admin-only console data; the page gates before calling).

```ts
// src/data/admin.ts
import { createAdminClient } from '@/lib/supabase/admin'

export interface DeletedInvoiceRow { id: string; invoice_number: string; total: number; deleted_at: string; delete_reason: string | null; customers: { clinic_name: string } | null }
export interface ArchivedClinicRow { id: string; clinic_name: string; archived_at: string }
export interface AuditRow { id: string; actor_id: string; action: string; entity_type: string; entity_label: string | null; reason: string | null; created_at: string }

export async function getDeletedInvoices(): Promise<DeletedInvoiceRow[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('invoices')
    .select('id, invoice_number, total, deleted_at, delete_reason, customers(clinic_name)')
    .not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  return (data ?? []) as unknown as DeletedInvoiceRow[]
}

export async function getArchivedClinics(): Promise<ArchivedClinicRow[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('customers')
    .select('id, clinic_name, archived_at').not('archived_at', 'is', null).order('archived_at', { ascending: false })
  return (data ?? []) as ArchivedClinicRow[]
}

export async function getAuditFeed(limit = 100): Promise<AuditRow[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('admin_audit_log')
    .select('id, actor_id, action, entity_type, entity_label, reason, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  return (data ?? []) as AuditRow[]
}

export async function getClinicDependencyCounts(id: string): Promise<{ invoices: number; credits: number }> {
  const admin = createAdminClient()
  const [{ count: invoices }, { count: credits }] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    admin.from('credits').select('id', { count: 'exact', head: true }).eq('customer_id', id),
  ])
  return { invoices: invoices ?? 0, credits: credits ?? 0 }
}
```

- [ ] **Step 4: Run + commit**

```bash
git add src/data/admin.ts src/integration/admin-reads.integration.test.ts
git commit -m "feat(admin): console read queries"
```

---

## Task 8: Admin Console page + client UI + nav entry

**Files:**
- Create: `src/app/(authenticated)/settings/admin/page.tsx`
- Create: `src/app/(authenticated)/settings/admin/AdminConsoleClient.tsx`
- Modify: `src/domain/navigation.ts` (add superadmin-only entry)

**Interfaces:**
- Consumes: Task 5/6 actions, Task 7 reads, `requireSuperadmin`.

- [ ] **Step 1: Server page with gate + parallel load**

```tsx
// src/app/(authenticated)/settings/admin/page.tsx
import { redirect } from 'next/navigation'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import { getDeletedInvoices, getArchivedClinics, getAuditFeed } from '@/data/admin'
import { AdminConsoleClient } from './AdminConsoleClient'

export default async function AdminConsolePage() {
  const gate = await requireSuperadmin()
  if (gate.ok === false) redirect('/dashboard')
  const [deletedInvoices, archivedClinics, audit] = await Promise.all([
    getDeletedInvoices(), getArchivedClinics(), getAuditFeed(),
  ])
  return <AdminConsoleClient deletedInvoices={deletedInvoices} archivedClinics={archivedClinics} audit={audit} />
}
```

- [ ] **Step 2: Client UI** — tabbed: **Recycle Bin** (deleted invoices: Restore / Delete permanently; archived clinics: Purge with dependency guard), **Activity** (audit feed). Use existing UI primitives (Card, Tabs, AlertDialog with typed confirmation). Wire buttons to the Task 5/6 actions; show returned `error` in a toast.

- [ ] **Step 3: Add nav entry** in `src/domain/navigation.ts` `settingsGroups(...)` — a new entry `{ href: '/settings/admin', label: 'Admin Console', icon: <ShieldIcon> }` included only when `isSuperadmin` is true (follow the existing superadmin-gated `roles` entry pattern).

- [ ] **Step 4: Verify in app**

Run: `npm run dev` → visit http://localhost:6060/settings/admin as Super Admin (renders) and as a non-superadmin (redirects). Confirm nav entry only shows for Super Admin.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/(authenticated)/settings/admin src/domain/navigation.ts
git commit -m "feat(admin): Super Admin Console page, recycle bin + activity UI"
```

---

## Task 9: Read-site filtering for deleted invoices

**Files:**
- Modify: `src/data/invoices.ts` (lines 76, 128, 198, and by-id 216/288), `src/data/dashboard.ts` (35/45/51), `src/data/reports.ts` (10), `src/data/work.ts`, `src/data/customers.ts` (108, 134)
- Test: `src/integration/deleted-invoice-hidden.integration.test.ts`

**Interfaces:**
- Consumes: `invoices.deleted_at` (Task 4). No new exports.

- [ ] **Step 1: Write integration test** — seed a soft-deleted invoice; assert it is absent from `getInvoices`, `getInvoicesPage` (all views incl. `voided`), `getInvoiceViewCounts`, dashboard metrics, reports aggregates, the work queue, the customer detail invoice list, and the clinic statement.

- [ ] **Step 2: Run, verify fail** (deleted invoice currently leaks into lists).

Run: `npm run test:integration -- deleted-invoice-hidden`
Expected: FAIL.

- [ ] **Step 3: Add `.is('deleted_at', null)` to every invoice read.** For `getInvoicesPage`, add it to the base query before the view branch (so even the `voided` view excludes deleted). For by-id detail reads (`getInvoiceDetail` 216, and 288), add `.is('deleted_at', null)` so a deep link to a deleted invoice 404s in the normal UI. For `customers.ts` detail list (108) and statement (134), add the filter. For `dashboard.ts`, `reports.ts`, `work.ts`, add to each invoice read.

- [ ] **Step 4: Run + verify no leak**

Run: `npm run test:integration -- deleted-invoice-hidden && grep -rn "from('invoices')" src/data | grep -v deleted_at`
Expected: PASS; the grep shows only by-id reads that intentionally include the filter and write paths.

- [ ] **Step 5: Commit**

```bash
git add src/data/invoices.ts src/data/dashboard.ts src/data/reports.ts src/data/work.ts src/data/customers.ts src/integration/deleted-invoice-hidden.integration.test.ts
git commit -m "feat(admin): hide soft-deleted invoices from all read sites"
```

---

## Task 10: Invoice & clinic UI entry points (delete buttons)

**Files:**
- Modify: `src/components/invoices/detail/ActionsBar.tsx` (add Super-Admin "Delete invoice" → `softDeleteInvoiceAction`; on a voided invoice show "Restore from void" → `restoreVoidedInvoiceAction`)
- Modify: clinics detail header/actions to add a Super-Admin "Archive"/"Purge" affordance routing into the console where appropriate.

**Interfaces:**
- Consumes: Task 5 actions; `useAuth().isSuperadmin` for hide-not-show.

- [ ] **Step 1:** Gate the new buttons behind `isSuperadmin`; wire confirmations (typed for purge). Soft-delete from the invoice detail redirects to `/invoices` on success.
- [ ] **Step 2:** Typecheck + manual verify at http://localhost:6060.
- [ ] **Step 3: Commit** `git commit -m "feat(admin): superadmin delete/restore entry points on invoice + clinic"`

---

## Deferred (separate follow-up plans)

These are scoped but intentionally NOT in this plan to keep it shippable. Each becomes its own plan when requested:

- **Payment delete** (`payment.delete`) — hard-delete a payment + recompute balance via the snapshot; audit.
- **Credit view + delete** (`credit.delete`) — surface `credits` (no UI today) in the console; hard-delete; audit.
- **Product hard-delete when unreferenced** (`product.delete`).
- **Employee hard-delete when unreferenced** (`employee.delete`), preserving the last-Super-Admin guard.

---

## Self-Review

- **Spec coverage:** SA lockdown → T1. Audit log → T2/T3 + writes in T5/T6. Invoice soft-delete/restore/void-restore/purge → T4/T5. Clinic purge (reusing existing archive) → T6. Recycle bin + Activity UI + nav → T7/T8. Read-site filtering ("the hard part") → T9. Entry points → T10. Payments/credits/products/employees → explicitly deferred.
- **Placeholders:** none — every code step shows runnable code; the only TODOs are test bodies that must be filled against the existing `archive-clinics.integration.test.ts` harness (referenced explicitly).
- **Type consistency:** `ActionResult` shape consistent; `requireSuperadmin()` returns `{ok,userId}` used uniformly; `writeAuditLog`/`AuditEntry`/`AuditAction` names consistent across T3/T5/T6; `admin_restore_void` RPC defined in T4 and called in T5.
