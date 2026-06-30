# Invoice Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which user performed each invoice action (issue, record payment, void, edits, credits, admin delete/restore/purge) into an append-only `invoice_activity_log`, surfaced as a per-invoice timeline and a superadmin "Invoice Activity" view.

**Architecture:** Action-layer capture (Approach A). Server actions already hold the acting user via `requirePermission()`/`requireSuperadmin()` (reliable even under the service-role client). After each mutation an action calls a best-effort `logInvoiceActivity()` helper that inserts one structured row. Work-status changes stay in the existing `invoice_item_status_history` trigger table and are merged into the timeline at read time. Reads go through gated server functions using the admin client (mirrors the existing `admin_audit_log` / `getAuditFeed` pattern).

**Tech Stack:** Next.js (App Router, RSC + client islands), TypeScript, Supabase (Postgres + service-role admin client), vitest (unit + integration), date-fns v4, Tailwind/shadcn UI.

## Global Constraints

- **Naming rule:** UI says **"Clinic"**; code/DB/routes/types/permission keys use `customer`. Action *labels* shown to users must use "Clinic" terminology where a customer is involved.
- **Verification gates:** only `npm run build` and `npm test` (vitest unit) are usable. `tsc` and lint are NOT usable. Integration tests run via `npm run test:integration` against a local Supabase stack (`supabase start`).
- **Migrations:** apply via Supabase MCP `apply_migration`; also commit the `.sql` file under `supabase/migrations/` (local integration tests apply migration files). New filename must sort after `20260624145126_clinic_archived_at.sql` → use `20260630000000_invoice_activity_log.sql`.
- **Types:** after migration, regenerate with MCP `generate_typescript_types` into `src/lib/database-generated.types.ts`, then add a domain alias in `src/lib/database.types.ts`.
- **Logging is best-effort:** `logInvoiceActivity` must NEVER throw and must never abort the mutation it accompanies (mirror `writeAuditLog` at `src/lib/audit/audit-log.ts:23-39`).
- **Audit table is append-only & service-role only:** RLS enabled, no policies; a `BEFORE UPDATE OR DELETE` trigger raises. No foreign keys (mirrors `admin_audit_log`).
- **Money/date helpers:** `formatCurrency` (MYR) and `formatDate` (`dd-MMM-yyyy`) live in `src/lib/utils.ts`; timestamps are `timestamptz` (UTC) rendered in MYT.

---

## File Structure

**Create:**
- `supabase/migrations/20260630000000_invoice_activity_log.sql` — table + indexes + RLS + append-only trigger + backfill.
- `src/lib/audit/diff.ts` — `diffFields()` + `FieldChange` type (pure, unit-tested).
- `src/lib/audit/diff.test.ts`
- `src/lib/audit/action-labels.ts` — action key → user label + field key → label maps.
- `src/lib/audit/action-labels.test.ts`
- `src/data/invoice-activity.ts` — `getInvoiceActivity(invoiceId)` (per-invoice timeline) + `TimelineEvent` type.
- `src/data/invoice-activity.test.ts`
- `src/components/invoices/detail/InvoiceActivityPanel.tsx` — client timeline panel.
- `src/integration/invoice-activity.integration.test.ts` — migration immutability/RLS + action-emits-row tests.

**Modify:**
- `src/lib/auth/require-permission.ts` — add `actorName` to `PermissionCheck` + both gates.
- `src/lib/auth/require-permission.test.ts` (create if absent) — actorName coverage.
- `src/lib/audit/audit-log.ts` — add `InvoiceActivityAction`, `InvoiceActivityEntry`, `logInvoiceActivity()`.
- `src/lib/audit/audit-log.test.ts` — add `logInvoiceActivity` cases.
- `src/lib/utils.ts` — add `formatRelativeTime()`.
- `src/lib/utils.test.ts` (create if absent) — `formatRelativeTime` coverage.
- `src/data/invoice-actions.ts` — wire create/issue/payment/edit/case/service-status/recipient/work-note logging.
- `src/lib/invoices/void-actions.ts` — wire `invoice.voided`.
- `src/lib/admin/admin-actions.ts` — additive `logInvoiceActivity` on soft-delete/restore/void-restore/purge.
- `src/data/credits.ts` — wire `credit.recorded`.
- `src/data/admin.ts` — add `getInvoiceActivityFeed()` + `InvoiceActivityFeedRow`.
- `src/app/(authenticated)/settings/admin/page.tsx` — fetch + pass invoice activity feed.
- `src/app/(authenticated)/settings/admin/AdminConsoleClient.tsx` — new "Invoice Activity" tab.
- `src/app/(authenticated)/invoices/[id]/page.tsx` — fetch activity + render panel.
- `src/lib/database.types.ts` — `InvoiceActivityLog` alias.

---

## Task 1: Migration — `invoice_activity_log` table, RLS, append-only trigger, backfill

**Files:**
- Create: `supabase/migrations/20260630000000_invoice_activity_log.sql`
- Modify: `src/lib/database.types.ts` (add alias after regen)

**Interfaces:**
- Produces: table `public.invoice_activity_log(id, invoice_id, actor_id, actor_name, action, entity_label, changes, reason, metadata, created_at)`; TS alias `InvoiceActivityLog`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260630000000_invoice_activity_log.sql
-- Per-invoice activity / audit timeline. APPEND-ONLY. Written ONLY via the
-- service-role admin client inside permission-gated server actions
-- (logInvoiceActivity). Mirrors admin_audit_log: RLS enabled, NO client policy,
-- and NO foreign keys (so a purged invoice's history survives, and the FK cascade
-- can't fire a forbidden UPDATE on this append-only table). Reads go through gated
-- server functions using the admin client.
create table if not exists public.invoice_activity_log (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid,                       -- plain uuid, no FK (survives purge)
  actor_id     uuid not null,              -- plain uuid, no FK (mirrors admin_audit_log)
  actor_name   text not null,              -- snapshot of profiles.full_name / username
  action       text not null,              -- e.g. 'invoice.issued', 'payment.recorded'
  entity_label text,                       -- snapshot of invoices.invoice_number
  changes      jsonb,                      -- [{field,label,from,to}] for edits; null otherwise
  reason       text,                       -- void/delete reasons
  metadata     jsonb,                      -- extra structured context
  created_at   timestamptz not null default now()
);

create index if not exists idx_invoice_activity_log_invoice
  on public.invoice_activity_log (invoice_id, created_at desc);
create index if not exists idx_invoice_activity_log_created_at
  on public.invoice_activity_log (created_at desc);
create index if not exists idx_invoice_activity_log_actor
  on public.invoice_activity_log (actor_id, created_at desc);

alter table public.invoice_activity_log enable row level security;
-- No policies on purpose: only the service role (admin client) may read/write.

-- Append-only: block UPDATE/DELETE even for the service role.
create or replace function public.prevent_invoice_activity_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'invoice_activity_log is append-only';
end;
$$;

drop trigger if exists trg_invoice_activity_log_immutable on public.invoice_activity_log;
create trigger trg_invoice_activity_log_immutable
  before update or delete on public.invoice_activity_log
  for each row execute function public.prevent_invoice_activity_mutation();

-- One-time backfill of known historical events from existing columns. actor_name
-- snapshots profiles.full_name (fallback username, then '(unknown)').
insert into public.invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label, created_at)
select i.id, i.created_by, coalesce(p.full_name, p.username, '(unknown)'),
       'invoice.created', i.invoice_number, i.created_at
from public.invoices i
left join public.profiles p on p.id = i.created_by;

insert into public.invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label, metadata, created_at)
select pay.invoice_id, pay.created_by, coalesce(p.full_name, p.username, '(unknown)'),
       'payment.recorded', i.invoice_number,
       jsonb_build_object('amount', pay.amount, 'payment_date', pay.payment_date, 'reference_number', pay.reference_number),
       pay.created_at
from public.payments pay
join public.invoices i on i.id = pay.invoice_id
left join public.profiles p on p.id = pay.created_by;

insert into public.invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label, reason, created_at)
select i.id, i.voided_by, coalesce(p.full_name, p.username, '(unknown)'),
       'invoice.voided', i.invoice_number, i.void_reason, i.voided_at
from public.invoices i
left join public.profiles p on p.id = i.voided_by
where i.voided_at is not null and i.voided_by is not null;

insert into public.invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label, reason, created_at)
select i.id, i.deleted_by, coalesce(p.full_name, p.username, '(unknown)'),
       'invoice.soft_deleted', i.invoice_number, i.delete_reason, i.deleted_at
from public.invoices i
left join public.profiles p on p.id = i.deleted_by
where i.deleted_at is not null and i.deleted_by is not null;
```

- [ ] **Step 2: Apply the migration to the remote project (MCP)**

Use the Supabase MCP tool `apply_migration` with `name: "invoice_activity_log"` and the SQL body above. Expected: success, no error. (If the project is production, confirm with the user before applying — this is an additive, non-destructive migration.)

- [ ] **Step 3: Regenerate TypeScript types (MCP)**

Run MCP `generate_typescript_types`; write the output to `src/lib/database-generated.types.ts` (overwrite). Expected: the file now contains an `invoice_activity_log` entry under `Tables`.

- [ ] **Step 4: Add the domain alias**

In `src/lib/database.types.ts`, add alongside the other `Tables<'...'>` aliases:

```typescript
export type InvoiceActivityLog = Tables<'invoice_activity_log'>
```

- [ ] **Step 5: Build to confirm types resolve**

Run: `npm run build`
Expected: PASS (no missing-type errors referencing `invoice_activity_log`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260630000000_invoice_activity_log.sql src/lib/database-generated.types.ts src/lib/database.types.ts
git commit -m "feat(audit): add append-only invoice_activity_log table + backfill"
```

---

## Task 2: Extend `requirePermission` / `requireSuperadmin` to return `actorName`

**Files:**
- Modify: `src/lib/auth/require-permission.ts`
- Test: `src/lib/auth/require-permission.test.ts` (create)

**Interfaces:**
- Produces: `PermissionCheck = { ok: true; userId: string; actorName: string } | { ok: false; error: string }`. Consumed by every wiring task (`gate.actorName`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/auth/require-permission.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const single = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}))

import { requirePermission, requireSuperadmin } from './require-permission'

beforeEach(() => {
  getUser.mockReset(); single.mockReset()
})

const profile = (over: Record<string, unknown> = {}) => ({
  active: true,
  full_name: 'Alice Tan',
  username: 'alice',
  roles: { is_system: false, role_permissions: [{ permission: 'invoices.manage' }] },
  ...over,
})

describe('requirePermission actorName', () => {
  it('returns actorName from full_name on success', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    single.mockResolvedValue({ data: profile() })
    const res = await requirePermission('invoices.manage')
    expect(res).toEqual({ ok: true, userId: 'u1', actorName: 'Alice Tan' })
  })

  it('falls back to username when full_name is null', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u2' } } })
    single.mockResolvedValue({ data: profile({ full_name: null }) })
    const res = await requirePermission('invoices.manage')
    expect(res).toEqual({ ok: true, userId: 'u2', actorName: 'alice' })
  })

  it('superadmin also returns actorName', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u3' } } })
    single.mockResolvedValue({ data: profile({ roles: { is_system: true, role_permissions: [] } }) })
    const res = await requireSuperadmin()
    expect(res).toEqual({ ok: true, userId: 'u3', actorName: 'Alice Tan' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- require-permission`
Expected: FAIL — `actorName` missing from the returned object / type error in mock data shape.

- [ ] **Step 3: Implement**

Edit `src/lib/auth/require-permission.ts`:

```typescript
export type PermissionCheck =
  | { ok: true; userId: string; actorName: string }
  | { ok: false; error: string }

// Shape returned by the profiles->roles->role_permissions embed.
type ProfileWithRole = {
  active: boolean
  full_name: string | null
  username: string | null
  roles: { is_system: boolean; role_permissions: { permission: string }[] } | null
}

async function loadRole(): Promise<{ userId: string; profile: ProfileWithRole } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('active, full_name, username, roles(is_system, role_permissions(permission))')
    .eq('id', user.id)
    .single()

  if (!data) return null
  return { userId: user.id, profile: data as unknown as ProfileWithRole }
}

function actorNameOf(profile: ProfileWithRole): string {
  return profile.full_name ?? profile.username ?? '(unknown)'
}

export async function requirePermission(permission: string): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles) return { ok: false, error: 'Access denied' }

  const granted = permissionGranted(
    { is_system: profile.roles.is_system, permissions: profile.roles.role_permissions.map(p => p.permission) },
    permission,
  )
  if (!granted) return { ok: false, error: 'You do not have permission to do this.' }
  return { ok: true, userId, actorName: actorNameOf(profile) }
}

export async function requireSuperadmin(): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles?.is_system) {
    return { ok: false, error: 'Super Admin access required' }
  }
  return { ok: true, userId, actorName: actorNameOf(profile) }
}
```

- [ ] **Step 4: Run tests + build**

Run: `npm test -- require-permission` → Expected: PASS.
Run: `npm run build` → Expected: PASS (adding a field to the success union is backward-compatible; existing `gate.userId` reads still type-check).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/require-permission.ts src/lib/auth/require-permission.test.ts
git commit -m "feat(auth): return actorName from permission gates"
```

---

## Task 3: `logInvoiceActivity()` helper + types

**Files:**
- Modify: `src/lib/audit/audit-log.ts`
- Test: `src/lib/audit/audit-log.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `logServerError` (already imported in the file).
- Produces:
  ```typescript
  export type InvoiceActivityAction =
    | 'invoice.created' | 'invoice.issued' | 'invoice.edited'
    | 'invoice.recipient_changed' | 'invoice.case_changed'
    | 'invoice.service_status_changed' | 'invoice.work_note_changed'
    | 'payment.recorded' | 'credit.recorded'
    | 'invoice.voided' | 'invoice.soft_deleted' | 'invoice.restored'
    | 'invoice.void_restored' | 'invoice.purged'
    | 'payment.deleted' | 'credit.deleted'
  export interface InvoiceActivityEntry {
    invoiceId: string | null
    actorId: string
    actorName: string
    action: InvoiceActivityAction
    entityLabel?: string | null
    changes?: unknown
    reason?: string | null
    metadata?: Record<string, unknown> | null
  }
  export function logInvoiceActivity(entry: InvoiceActivityEntry): Promise<void>
  ```

- [ ] **Step 1: Write the failing test (append to `audit-log.test.ts`)**

```typescript
// add to src/lib/audit/audit-log.test.ts
import { logInvoiceActivity } from './audit-log'

describe('logInvoiceActivity', () => {
  it('inserts a normalized invoice activity row', async () => {
    insert.mockClear()
    await logInvoiceActivity({
      invoiceId: 'i1', actorId: 'u1', actorName: 'Alice Tan',
      action: 'payment.recorded', entityLabel: 'INV-1042',
      metadata: { amount: 200 },
    })
    expect(insert).toHaveBeenCalledWith({
      invoice_id: 'i1', actor_id: 'u1', actor_name: 'Alice Tan',
      action: 'payment.recorded', entity_label: 'INV-1042',
      changes: null, reason: null, metadata: { amount: 200 },
    })
  })

  it('defaults optional fields to null', async () => {
    insert.mockClear()
    await logInvoiceActivity({ invoiceId: 'i2', actorId: 'u2', actorName: 'Bob', action: 'invoice.issued' })
    expect(insert).toHaveBeenCalledWith({
      invoice_id: 'i2', actor_id: 'u2', actor_name: 'Bob', action: 'invoice.issued',
      entity_label: null, changes: null, reason: null, metadata: null,
    })
  })

  it('never throws when the insert errors', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } })
    await expect(
      logInvoiceActivity({ invoiceId: 'i3', actorId: 'u3', actorName: 'C', action: 'invoice.voided' }),
    ).resolves.toBeUndefined()
  })
})
```

Note: the existing mock at the top of the file is `createAdminClient: () => ({ from: () => ({ insert }) })` — the same `insert` mock is reused, so no mock change is needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- audit-log`
Expected: FAIL — `logInvoiceActivity` not exported.

- [ ] **Step 3: Implement (append to `src/lib/audit/audit-log.ts`)**

```typescript
export type InvoiceActivityAction =
  | 'invoice.created' | 'invoice.issued' | 'invoice.edited'
  | 'invoice.recipient_changed' | 'invoice.case_changed'
  | 'invoice.service_status_changed' | 'invoice.work_note_changed'
  | 'payment.recorded' | 'credit.recorded'
  | 'invoice.voided' | 'invoice.soft_deleted' | 'invoice.restored'
  | 'invoice.void_restored' | 'invoice.purged'
  | 'payment.deleted' | 'credit.deleted'

export interface InvoiceActivityEntry {
  invoiceId: string | null
  actorId: string
  actorName: string
  action: InvoiceActivityAction
  entityLabel?: string | null
  changes?: unknown
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

// Best-effort per-invoice activity write. Never throws — a failed insert must not
// abort the action it accompanies (same contract as writeAuditLog above).
export async function logInvoiceActivity(entry: InvoiceActivityEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('invoice_activity_log').insert({
      invoice_id: entry.invoiceId,
      actor_id: entry.actorId,
      actor_name: entry.actorName,
      action: entry.action,
      entity_label: entry.entityLabel ?? null,
      changes: (entry.changes ?? null) as never,
      reason: entry.reason ?? null,
      metadata: (entry.metadata ?? null) as never,
    })
    if (error) logServerError('logInvoiceActivity', error, { action: entry.action })
  } catch (e) {
    logServerError('logInvoiceActivity', e, { action: entry.action })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- audit-log` → Expected: PASS (all old + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/audit-log.ts src/lib/audit/audit-log.test.ts
git commit -m "feat(audit): add logInvoiceActivity helper"
```

---

## Task 4: Field-diff helper

**Files:**
- Create: `src/lib/audit/diff.ts`, `src/lib/audit/diff.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface FieldChange { field: string; label: string; from: unknown; to: unknown }
  export function diffFields(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    labels: Record<string, string>,
  ): FieldChange[]
  ```
  Only keys present in `labels` are compared. Values are normalized so `null`, `undefined`, and `''` are treated as equal (avoids false diffs from empty form fields). Numbers compared by `Number()`. Returns `[]` when nothing changed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/audit/diff.test.ts
import { describe, it, expect } from 'vitest'
import { diffFields } from './diff'

const LABELS = { due_date: 'Due date', patient: 'Patient', total: 'Total' }

describe('diffFields', () => {
  it('returns only changed labelled fields', () => {
    const out = diffFields(
      { due_date: '2026-06-01', patient: 'A', total: 100, ignored: 'x' },
      { due_date: '2026-06-15', patient: 'A', total: 100, ignored: 'y' },
      LABELS,
    )
    expect(out).toEqual([{ field: 'due_date', label: 'Due date', from: '2026-06-01', to: '2026-06-15' }])
  })

  it('treats null, undefined and empty string as equal', () => {
    const out = diffFields({ patient: null }, { patient: '' }, LABELS)
    expect(out).toEqual([])
  })

  it('detects a real string change from empty to value', () => {
    const out = diffFields({ patient: null }, { patient: 'Jane' }, LABELS)
    expect(out).toEqual([{ field: 'patient', label: 'Patient', from: null, to: 'Jane' }])
  })

  it('compares numbers by value not type', () => {
    const out = diffFields({ total: 100 }, { total: '100' }, LABELS)
    expect(out).toEqual([])
  })

  it('returns empty array when nothing changed', () => {
    expect(diffFields({ patient: 'A' }, { patient: 'A' }, LABELS)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- audit/diff`
Expected: FAIL — module `./diff` not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/audit/diff.ts
export interface FieldChange {
  field: string
  label: string
  from: unknown
  to: unknown
}

// Normalize so empties (null/undefined/'') compare equal, and numeric strings
// compare by value. Everything else compares by its string form.
function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return String(Number(v))
  return String(v)
}

export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [field, label] of Object.entries(labels)) {
    if (norm(before[field]) !== norm(after[field])) {
      changes.push({ field, label, from: before[field] ?? null, to: after[field] ?? null })
    }
  }
  return changes
}
```

- [ ] **Step 4: Run tests** → Run: `npm test -- audit/diff` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/diff.ts src/lib/audit/diff.test.ts
git commit -m "feat(audit): add diffFields helper"
```

---

## Task 5: Action + field labels

**Files:**
- Create: `src/lib/audit/action-labels.ts`, `src/lib/audit/action-labels.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function actionLabel(action: string): string
  export const INVOICE_FIELD_LABELS: Record<string, string>      // header/case/service-status fields
  export const RECIPIENT_FIELD_LABELS: Record<string, string>    // bill-to / ship-to / addresses
  ```
  Consumed by wiring tasks (field labels) and UI tasks (action labels). Uses "Clinic" terminology.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/audit/action-labels.test.ts
import { describe, it, expect } from 'vitest'
import { actionLabel, INVOICE_FIELD_LABELS, RECIPIENT_FIELD_LABELS } from './action-labels'

describe('actionLabel', () => {
  it('maps known keys to friendly labels', () => {
    expect(actionLabel('invoice.issued')).toBe('Issued invoice')
    expect(actionLabel('payment.recorded')).toBe('Recorded payment')
    expect(actionLabel('invoice.voided')).toBe('Voided invoice')
    expect(actionLabel('work_status.changed')).toBe('Changed work status')
  })
  it('falls back to the raw key for unknown actions', () => {
    expect(actionLabel('something.weird')).toBe('something.weird')
  })
})

describe('field label maps', () => {
  it('uses Clinic terminology and covers diffed fields', () => {
    expect(INVOICE_FIELD_LABELS.due_date).toBe('Due date')
    expect(INVOICE_FIELD_LABELS.service_status_id).toBe('Service status')
    expect(RECIPIENT_FIELD_LABELS.bill_to_name).toBe('Bill-to name')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** → Run: `npm test -- action-labels` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// src/lib/audit/action-labels.ts
// User-facing labels for audit/timeline rows. No i18n system exists, so labels are
// hardcoded; customer-facing terminology says "Clinic" per project convention.

const ACTION_LABELS: Record<string, string> = {
  'invoice.created': 'Created invoice',
  'invoice.issued': 'Issued invoice',
  'invoice.edited': 'Edited invoice',
  'invoice.recipient_changed': 'Updated recipient',
  'invoice.case_changed': 'Updated case details',
  'invoice.service_status_changed': 'Changed service status',
  'invoice.work_note_changed': 'Updated work note',
  'payment.recorded': 'Recorded payment',
  'credit.recorded': 'Issued credit',
  'invoice.voided': 'Voided invoice',
  'invoice.soft_deleted': 'Deleted invoice',
  'invoice.restored': 'Restored invoice',
  'invoice.void_restored': 'Restored voided invoice',
  'invoice.purged': 'Permanently deleted invoice',
  'payment.deleted': 'Deleted payment',
  'credit.deleted': 'Deleted credit',
  'work_status.changed': 'Changed work status',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

// Header/case/service-status fields diffed by invoice edit actions.
export const INVOICE_FIELD_LABELS: Record<string, string> = {
  invoice_date: 'Invoice date',
  due_date: 'Due date',
  notes: 'Remarks',
  patient: 'Patient',
  doctor: 'Doctor',
  service_status_id: 'Service status',
  total: 'Total',
  subtotal: 'Subtotal',
}

// Recipient (Bill-To / Deliver-To) fields diffed by saveRecipientAction.
export const RECIPIENT_FIELD_LABELS: Record<string, string> = {
  bill_to_name: 'Bill-to name',
  bill_to_contact: 'Bill-to contact',
  bill_to_phone: 'Bill-to phone',
  billing_address: 'Billing address',
  ship_to_name: 'Deliver-to name',
  ship_to_contact: 'Deliver-to contact',
  delivery_address: 'Delivery address',
}
```

- [ ] **Step 4: Run tests** → Run: `npm test -- action-labels` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/action-labels.ts src/lib/audit/action-labels.test.ts
git commit -m "feat(audit): add action + field label maps"
```

---

## Task 6: `formatRelativeTime` utility

**Files:**
- Modify: `src/lib/utils.ts`
- Test: `src/lib/utils.test.ts` (create)

**Interfaces:**
- Produces: `export function formatRelativeTime(date: string | Date, now?: Date): string` — e.g. `"5 minutes ago"`. `now` param is injectable for deterministic tests.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './utils'

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-30T12:00:00Z')
  it('formats a recent past time relative to now', () => {
    expect(formatRelativeTime('2026-06-30T11:55:00Z', now)).toBe('5 minutes ago')
  })
  it('formats hours ago', () => {
    expect(formatRelativeTime('2026-06-30T09:00:00Z', now)).toBe('about 3 hours ago')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** → Run: `npm test -- utils` → Expected: FAIL (`formatRelativeTime` not exported).

- [ ] **Step 3: Implement (append to `src/lib/utils.ts`; add the import at the top)**

```typescript
// at top of src/lib/utils.ts, with the other imports:
import { formatDistanceToNow } from 'date-fns'

// ...existing exports...

// Relative timestamp for activity feeds, e.g. "5 minutes ago". `now` is injectable
// for deterministic tests; date-fns reads the system clock by default.
export function formatRelativeTime(date: string | Date, now?: Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, ...(now ? { } : {}) })
}
```

Note: `date-fns` v4's `formatDistanceToNow` does not accept a `now` baseline. To keep the test deterministic, implement with the lower-level `formatDistance` instead:

```typescript
import { formatDistance } from 'date-fns'

export function formatRelativeTime(date: string | Date, now: Date = new Date()): string {
  return formatDistance(new Date(date), now, { addSuffix: true })
}
```

Use the `formatDistance` version (delete the `formatDistanceToNow` import). It satisfies the injectable-`now` test.

- [ ] **Step 4: Run tests + build** → Run: `npm test -- utils` and `npm run build` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(utils): add formatRelativeTime"
```

---

## Task 7: Wire lifecycle actions (create / issue / payment)

**Files:**
- Modify: `src/data/invoice-actions.ts`

**Interfaces:**
- Consumes: `logInvoiceActivity`, `InvoiceActivityEntry` (Task 3); `gate.actorName` (Task 2).
- Produces: rows for `invoice.created`, `invoice.issued`, `payment.recorded`.

- [ ] **Step 1: Add imports + a label helper (top of file, after existing imports)**

```typescript
import { logInvoiceActivity } from '@/lib/audit/audit-log'

// Best-effort lookup of an invoice's number for the activity row's entity_label.
async function invoiceLabel(admin: ReturnType<typeof createAdminClient>, id: string): Promise<string | null> {
  const { data } = await admin.from('invoices').select('invoice_number').eq('id', id).single()
  return data?.invoice_number ?? null
}
```

- [ ] **Step 2: Log on create** — in `createInvoiceAction`, after `revalidatePath('/invoices')` and before `return { ok: true, id: ... }`:

```typescript
  const newId = data as string
  await logInvoiceActivity({
    invoiceId: newId, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.created', entityLabel: await invoiceLabel(admin, newId),
    metadata: { status: payload.p_invoice.status },
  })
  revalidatePath('/invoices')
  return { ok: true, id: newId }
```

(Replace the existing `revalidatePath('/invoices'); return { ok: true, id: data as string }` lines.)

- [ ] **Step 3: Log on issue** — in `markSentAction`, after the successful update, before `revalidateInvoice(id)`:

```typescript
  await logInvoiceActivity({
    invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.issued', entityLabel: await invoiceLabel(admin, id),
  })
```

- [ ] **Step 4: Log on payment** — in `recordPaymentAction`, after success, before `revalidateInvoice(id)`:

```typescript
  await logInvoiceActivity({
    invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
    action: 'payment.recorded', entityLabel: await invoiceLabel(admin, id),
    metadata: { amount: input.amount, payment_date: input.payment_date ?? null, reference_number: input.reference ?? null },
  })
```

- [ ] **Step 5: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/invoice-actions.ts
git commit -m "feat(audit): log invoice create/issue/payment activity"
```

---

## Task 8: Wire edit actions with field diffs (invoice edit / case / service status / recipient / work note)

**Files:**
- Modify: `src/data/invoice-actions.ts`

**Interfaces:**
- Consumes: `diffFields`, `FieldChange` (Task 4); `INVOICE_FIELD_LABELS`, `RECIPIENT_FIELD_LABELS` (Task 5); `logInvoiceActivity` (Task 3).
- Produces: rows for `invoice.edited`, `invoice.case_changed`, `invoice.service_status_changed`, `invoice.recipient_changed`, `invoice.work_note_changed`. No-op edits emit nothing.

- [ ] **Step 1: Add imports (top of file)**

```typescript
import { diffFields } from '@/lib/audit/diff'
import { INVOICE_FIELD_LABELS, RECIPIENT_FIELD_LABELS } from '@/lib/audit/action-labels'
```

- [ ] **Step 2: `updateCaseDetailsAction`** — read before-row, diff, log if changed. Replace the body after the gate:

```typescript
  const admin = createAdminClient()
  const { data: before } = await admin.from('invoices').select('patient, doctor, invoice_number').eq('id', id).single()
  const { error } = await admin
    .from('invoices')
    .update({ patient: input.patient, doctor: input.doctor })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  const changes = diffFields(before ?? {}, input, { patient: 'Patient', doctor: 'Doctor' })
  if (changes.length > 0) {
    await logInvoiceActivity({
      invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.case_changed', entityLabel: before?.invoice_number ?? null, changes,
    })
  }
  revalidateInvoice(id)
  return { ok: true }
```

- [ ] **Step 3: `updateServiceStatusAction`** — diff the single field; resolve labels in metadata for readability:

```typescript
  const admin = createAdminClient()
  const { data: before } = await admin.from('invoices').select('service_status_id, invoice_number').eq('id', id).single()
  const { error } = await admin
    .from('invoices')
    .update({ service_status_id: serviceStatusId })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  if ((before?.service_status_id ?? null) !== (serviceStatusId ?? null)) {
    await logInvoiceActivity({
      invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.service_status_changed', entityLabel: before?.invoice_number ?? null,
      changes: [{ field: 'service_status_id', label: 'Service status', from: before?.service_status_id ?? null, to: serviceStatusId ?? null }],
    })
  }
  revalidateInvoice(id)
  return { ok: true }
```

- [ ] **Step 4: `saveRecipientAction`** — diff the recipient field set:

```typescript
  const admin = createAdminClient()
  const recipientCols = 'bill_to_name, bill_to_contact, bill_to_phone, billing_address, ship_to_name, ship_to_contact, delivery_address, invoice_number'
  const { data: before } = await admin.from('invoices').select(recipientCols).eq('id', id).single()
  const { error } = await admin.from('invoices').update(fields).eq('id', id)
  if (error) return { ok: false, error: error.message }
  // ...existing alsoSaveToCustomer block stays unchanged...
  const changes = diffFields((before ?? {}) as Record<string, unknown>, fields as unknown as Record<string, unknown>, RECIPIENT_FIELD_LABELS)
  if (changes.length > 0) {
    await logInvoiceActivity({
      invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.recipient_changed',
      entityLabel: (before as { invoice_number?: string } | null)?.invoice_number ?? null,
      changes,
    })
  }
  revalidateInvoice(id)
  return { ok: true }
```

(Insert the diff/log block after the `alsoSaveToCustomer` block, before `revalidateInvoice(id)`.)

- [ ] **Step 5: `updateInvoiceAction`** — header diff + line-item summary. Replace the body after the gate:

```typescript
  const admin = createAdminClient()
  const { data: beforeInv } = await admin
    .from('invoices')
    .select('invoice_date, due_date, notes, patient, doctor, service_status_id, subtotal, total, invoice_number')
    .eq('id', id).single()
  const { data: beforeItems } = await admin
    .from('invoice_items').select('id').eq('invoice_id', id)
  const beforeCount = beforeItems?.length ?? 0

  const { error } = await admin.rpc('update_invoice_with_items', {
    p_invoice_id: id,
    p_invoice: payload.p_invoice as unknown as Json,
    p_items: payload.p_items as unknown as Json,
  })
  if (error) return { ok: false, error: error.message }

  const headerChanges = diffFields((beforeInv ?? {}) as Record<string, unknown>, payload.p_invoice as unknown as Record<string, unknown>, INVOICE_FIELD_LABELS)
  const afterCount = payload.p_items.length
  const keptIds = new Set(payload.p_items.filter(i => i.id).map(i => i.id))
  const removed = (beforeItems ?? []).filter(b => !keptIds.has(b.id)).length
  const added = payload.p_items.filter(i => !i.id).length
  const itemSummary = { before_count: beforeCount, after_count: afterCount, added, removed }
  const itemsChanged = added > 0 || removed > 0
  if (headerChanges.length > 0 || itemsChanged) {
    await logInvoiceActivity({
      invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.edited', entityLabel: beforeInv?.invoice_number ?? null,
      changes: headerChanges.length > 0 ? headerChanges : null,
      metadata: itemsChanged ? { items: itemSummary } : null,
    })
  }
  revalidateInvoice(id)
  return { ok: true }
```

- [ ] **Step 6: `updateWorkNoteAction`** — uses the SSR client for the write (keep that), reads the old note via the admin client for diffing, logs via the admin client. Replace the body after the gate:

```typescript
  const supabase = await createClient()
  const trimmed = workNote?.trim()
  const value = trimmed ? trimmed : null

  const { data, error } = await supabase
    .from('invoice_items')
    .update({ work_note: value })
    .eq('id', itemId)
    .select('invoice_id, description, work_note')
    .single()
  if (error) return { ok: false, error: error.message }

  // The select above returns the POST-update row; read the prior note via a
  // lightweight admin lookup is unnecessary — instead capture the change intent.
  await logInvoiceActivity({
    invoiceId: data?.invoice_id ?? null, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.work_note_changed', entityLabel: null,
    metadata: { item: data?.description ?? null, note: value },
  })
  if (data?.invoice_id) revalidateInvoice(data.invoice_id)
  return { ok: true }
```

Note: `gate` here comes from `requirePermission('invoices.view')`, which now returns `actorName`. Work notes are low-volume; we log every save (no before/after diff) to keep this action's single-query shape. If a no-op suppression is desired later, read the prior `work_note` first.

- [ ] **Step 7: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data/invoice-actions.ts
git commit -m "feat(audit): log invoice edit/case/service-status/recipient/work-note changes with field diffs"
```

---

## Task 9: Wire void + admin destructive actions (additive)

**Files:**
- Modify: `src/lib/invoices/void-actions.ts`, `src/lib/admin/admin-actions.ts`

**Interfaces:**
- Consumes: `logInvoiceActivity` (Task 3); `gate.actorName` (Task 2).
- Produces: `invoice.voided`, `invoice.soft_deleted`, `invoice.restored`, `invoice.void_restored`, `invoice.purged`. Existing `writeAuditLog` calls remain.

- [ ] **Step 1: `voidInvoice`** — add import + log after the successful update (before `revalidatePath`):

```typescript
// add import:
import { logInvoiceActivity } from '@/lib/audit/audit-log'

// inside voidInvoice, after the update succeeds:
    const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
    await logInvoiceActivity({
      invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.voided', entityLabel: inv?.invoice_number ?? null,
      reason: input.reason?.trim() || null,
    })
```

- [ ] **Step 2: admin-actions.ts** — add import:

```typescript
import { logInvoiceActivity } from '@/lib/audit/audit-log'
```

- [ ] **Step 3: `softDeleteInvoiceAction`** — after the existing `writeAuditLog(...)` call, add:

```typescript
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.soft_deleted', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
```

- [ ] **Step 4: `restoreInvoiceAction`** — after its `writeAuditLog(...)`:

```typescript
  await logInvoiceActivity({
    invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.restored', entityLabel: inv?.invoice_number ?? null,
  })
```

- [ ] **Step 5: `restoreVoidedInvoiceAction`** — after its `writeAuditLog(...)`:

```typescript
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.void_restored', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
```

- [ ] **Step 6: `purgeInvoiceAction`** — after its `writeAuditLog(...)`. The invoice row is already deleted, so `invoiceId` is the (now-dangling) id and `entity_label` carries the number:

```typescript
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.purged', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
    metadata: { snapshot: (inv ?? null) as Record<string, unknown> | null },
  })
```

- [ ] **Step 7: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invoices/void-actions.ts src/lib/admin/admin-actions.ts
git commit -m "feat(audit): log void + admin destructive invoice actions (additive)"
```

---

## Task 10: Wire credits + locate/wire delete actions

**Files:**
- Modify: `src/data/credits.ts`
- Investigate: payment/credit delete actions (the `AuditAction` union references `payment.delete`/`credit.delete`).

**Interfaces:**
- Produces: `credit.recorded` (and `payment.deleted`/`credit.deleted` if such actions exist).

- [ ] **Step 1: `createCreditAction`** — add import + log after success. A credit may be invoice-scoped (`c.invoice_id`) or clinic-only; pass `invoiceId: c.invoice_id ?? null`:

```typescript
// add import:
import { logInvoiceActivity } from '@/lib/audit/audit-log'

// after the insert succeeds, before the revalidatePath calls:
  await logInvoiceActivity({
    invoiceId: c.invoice_id ?? null, actorId: gate.userId, actorName: gate.actorName,
    action: 'credit.recorded', entityLabel: null,
    metadata: { amount: c.amount, reason: c.reason, customer_id: customerId },
  })
```

- [ ] **Step 2: Locate delete actions**

Run: `grep -rn "payment.delete\|credit.delete\|deletePayment\|deleteCredit\|\.delete()" src/data src/lib`
Expected: identify any server action that deletes a payment or credit row.

- [ ] **Step 3: Wire them if present**

For each found delete action, after the successful delete and alongside any existing `writeAuditLog`, add a `logInvoiceActivity` call with `action: 'payment.deleted'` or `'credit.deleted'`, `invoiceId` = the affected invoice id (read it before deleting), `actorName: gate.actorName`, `reason` if available. If NO such actions exist, record that fact in the commit message and skip — the union members stay reserved for future use.

- [ ] **Step 4: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/credits.ts
git commit -m "feat(audit): log credit.recorded (+ payment/credit deletes if present)"
```

---

## Task 11: `getInvoiceActivity` read aggregator

**Files:**
- Create: `src/data/invoice-activity.ts`, `src/data/invoice-activity.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `requirePermission`.
- Produces:
  ```typescript
  export interface TimelineEvent {
    id: string
    at: string                 // ISO timestamp
    actorName: string
    action: string             // InvoiceActivityAction | 'work_status.changed'
    entityLabel?: string | null
    changes?: { field: string; label: string; from: unknown; to: unknown }[] | null
    reason?: string | null
    metadata?: Record<string, unknown> | null
  }
  export function getInvoiceActivity(invoiceId: string): Promise<TimelineEvent[]>
  ```
  Reads `invoice_activity_log` (by `invoice_id`) + `invoice_item_status_history` (joined via `invoice_items.invoice_id`), normalizes both, sorts by `at` desc. Returns `[]` if the gate fails.

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/invoice-activity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const activityRows = [
  { id: 'a1', created_at: '2026-06-30T10:00:00Z', actor_name: 'Alice', action: 'invoice.issued', entity_label: 'INV-1', changes: null, reason: null, metadata: null },
]
const historyRows = [
  { id: 'h1', changed_at: '2026-06-30T11:00:00Z', changed_by_name: 'Bob', status: 'in_progress', stage_id: null, invoice_items: { invoice_id: 'inv-1', description: 'Crown' } },
]

vi.mock('@/lib/auth/require-permission', () => ({
  requirePermission: async () => ({ ok: true, userId: 'u1', actorName: 'Alice' }),
}))

// Two sequential .from() calls: first activity log, then status history.
vi.mock('@/lib/supabase/admin', () => {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {}
    b.select = () => b; b.eq = () => b; b.order = () => Promise.resolve({ data: rows })
    return b
  }
  let call = 0
  return { createAdminClient: () => ({ from: () => (call++ === 0 ? builder(activityRows) : builder(historyRows)) }) }
})

import { getInvoiceActivity } from './invoice-activity'

beforeEach(() => {})

describe('getInvoiceActivity', () => {
  it('merges both sources newest-first and normalizes shapes', async () => {
    const out = await getInvoiceActivity('inv-1')
    expect(out.map(e => e.action)).toEqual(['work_status.changed', 'invoice.issued'])
    expect(out[0]).toMatchObject({ actorName: 'Bob', action: 'work_status.changed' })
    expect(out[1]).toMatchObject({ actorName: 'Alice', action: 'invoice.issued', entityLabel: 'INV-1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails** → Run: `npm test -- invoice-activity` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// src/data/invoice-activity.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'

export interface TimelineEvent {
  id: string
  at: string
  actorName: string
  action: string
  entityLabel?: string | null
  changes?: { field: string; label: string; from: unknown; to: unknown }[] | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

type ActivityRow = {
  id: string; created_at: string; actor_name: string; action: string
  entity_label: string | null; changes: unknown; reason: string | null
  metadata: Record<string, unknown> | null
}
type HistoryRow = {
  id: string; changed_at: string; changed_by_name: string | null
  status: string; stage_id: string | null
  invoice_items: { invoice_id: string; description: string | null } | null
}

// Per-invoice timeline: explicit activity-log events + work-status changes from the
// existing trigger table (no invoice_id there — filter via invoice_items). Gated by
// invoices.view; reads via the admin client (the page is already gated, RLS has no
// client policy). Merge + sort in TypeScript.
export async function getInvoiceActivity(invoiceId: string): Promise<TimelineEvent[]> {
  const gate = await requirePermission('invoices.view')
  if (!gate.ok) return []
  const admin = createAdminClient()

  const { data: activity } = await admin
    .from('invoice_activity_log')
    .select('id, created_at, actor_name, action, entity_label, changes, reason, metadata')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  const { data: history } = await admin
    .from('invoice_item_status_history')
    .select('id, changed_at, changed_by_name, status, stage_id, invoice_items!inner(invoice_id, description)')
    .eq('invoice_items.invoice_id', invoiceId)
    .order('changed_at', { ascending: false })

  const fromActivity: TimelineEvent[] = ((activity ?? []) as ActivityRow[]).map(r => ({
    id: r.id, at: r.created_at, actorName: r.actor_name, action: r.action,
    entityLabel: r.entity_label,
    changes: (r.changes ?? null) as TimelineEvent['changes'],
    reason: r.reason, metadata: r.metadata,
  }))

  const fromHistory: TimelineEvent[] = ((history ?? []) as unknown as HistoryRow[]).map(r => ({
    id: `ws-${r.id}`, at: r.changed_at, actorName: r.changed_by_name ?? '(unknown)',
    action: 'work_status.changed', entityLabel: null,
    metadata: { status: r.status, stage_id: r.stage_id, item: r.invoice_items?.description ?? null },
  }))

  return [...fromActivity, ...fromHistory].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
```

- [ ] **Step 4: Run tests** → Run: `npm test -- invoice-activity` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/invoice-activity.ts src/data/invoice-activity.test.ts
git commit -m "feat(audit): add getInvoiceActivity timeline aggregator"
```

---

## Task 12: Per-invoice Activity panel UI

**Files:**
- Create: `src/components/invoices/detail/InvoiceActivityPanel.tsx`
- Modify: `src/app/(authenticated)/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: `TimelineEvent` (Task 11), `actionLabel` (Task 5), `formatRelativeTime`/`formatDate` (Task 6 / utils).

- [ ] **Step 1: Create the panel (client component, expandable diffs)**

```tsx
// src/components/invoices/detail/InvoiceActivityPanel.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { actionLabel } from '@/lib/audit/action-labels'
import { formatRelativeTime, formatDate } from '@/lib/utils'
import type { TimelineEvent } from '@/data/invoice-activity'

function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

export function InvoiceActivityPanel({ events }: { events: TimelineEvent[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (events.length === 0) return null

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
        <p className="text-xs text-muted-foreground">Who did what on this invoice. Internal only — not printed.</p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {events.map(e => {
            const hasDiff = Array.isArray(e.changes) && e.changes.length > 0
            return (
              <li key={e.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{e.actorName}</span>{' '}
                    <span className="text-muted-foreground">{actionLabel(e.action).toLowerCase()}</span>
                    {e.reason ? <span className="text-muted-foreground"> — {e.reason}</span> : null}
                  </p>
                  <time className="shrink-0 text-xs text-muted-foreground" title={formatDate(e.at)}>
                    {formatRelativeTime(e.at)}
                  </time>
                </div>
                {hasDiff && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                  >
                    {open === e.id ? 'Hide changes' : `${e.changes!.length} field${e.changes!.length > 1 ? 's' : ''} changed`}
                  </button>
                )}
                {hasDiff && open === e.id && (
                  <ul className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                    {e.changes!.map((c, i) => (
                      <li key={i} className="flex flex-wrap gap-1">
                        <span className="font-medium text-foreground">{c.label}:</span>
                        <span className="text-muted-foreground line-through">{valueText(c.from)}</span>
                        <span aria-hidden>→</span>
                        <span className="text-foreground">{valueText(c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Render it in the invoice detail page**

In `src/app/(authenticated)/invoices/[id]/page.tsx`:

Add imports (with the other imports at top):
```typescript
import { getInvoiceActivity } from '@/data/invoice-activity'
import { InvoiceActivityPanel } from '@/components/invoices/detail/InvoiceActivityPanel'
```

Add `getInvoiceActivity(id)` to the existing `Promise.all` and capture it:
```typescript
  const { id } = await params
  const [data, billingSettings, activity] = await Promise.all([
    getInvoiceDetail(id),
    getBillingSettings(),
    getInvoiceActivity(id),
  ])
```

Render the panel as the last child inside the outer `<div className="w-full max-w-5xl space-y-6">`, after the Payment History block (after line 170's closing `)}`):
```tsx
      <InvoiceActivityPanel events={activity} />
```

- [ ] **Step 3: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 4: Manual smoke (dev server on 6060)**

Run: `npm run dev` (port 6060). Open an invoice, perform an action (e.g. Mark as Sent, record a payment, edit case details), refresh, confirm the Activity panel lists the event with your name + relative time, and field diffs expand for edits.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoices/detail/InvoiceActivityPanel.tsx "src/app/(authenticated)/invoices/[id]/page.tsx"
git commit -m "feat(audit): per-invoice Activity timeline panel"
```

---

## Task 13: Admin "Invoice Activity" view

**Files:**
- Modify: `src/data/admin.ts`, `src/app/(authenticated)/settings/admin/page.tsx`, `src/app/(authenticated)/settings/admin/AdminConsoleClient.tsx`

**Interfaces:**
- Produces: `getInvoiceActivityFeed(limit?)` → `InvoiceActivityFeedRow[]`; a new "Invoice Activity" tab.

- [ ] **Step 1: Add the feed query to `src/data/admin.ts`**

```typescript
export interface InvoiceActivityFeedRow {
  id: string
  actor_name: string
  action: string
  entity_label: string | null
  reason: string | null
  created_at: string
}

export async function getInvoiceActivityFeed(limit = 200): Promise<InvoiceActivityFeedRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('invoice_activity_log')
    .select('id, actor_name, action, entity_label, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as InvoiceActivityFeedRow[]
}
```

- [ ] **Step 2: Fetch + pass it in `settings/admin/page.tsx`**

```typescript
import { getDeletedInvoices, getArchivedClinics, getAuditFeed, getInvoiceActivityFeed } from '@/data/admin'

  const [deletedInvoices, archivedClinics, audit, invoiceActivity] = await Promise.all([
    getDeletedInvoices(),
    getArchivedClinics(),
    getAuditFeed(),
    getInvoiceActivityFeed(),
  ])

  return (
    <AdminConsoleClient
      deletedInvoices={deletedInvoices}
      archivedClinics={archivedClinics}
      audit={audit}
      invoiceActivity={invoiceActivity}
    />
  )
```

- [ ] **Step 3: Add the tab in `AdminConsoleClient.tsx`**

Add to imports:
```typescript
import type { DeletedInvoiceRow, ArchivedClinicRow, AuditRow, InvoiceActivityFeedRow } from '@/data/admin'
import { actionLabel } from '@/lib/audit/action-labels'
```

Extend the props:
```typescript
export function AdminConsoleClient({
  deletedInvoices, archivedClinics, audit, invoiceActivity,
}: {
  deletedInvoices: DeletedInvoiceRow[]
  archivedClinics: ArchivedClinicRow[]
  audit: AuditRow[]
  invoiceActivity: InvoiceActivityFeedRow[]
}) {
```

Add a trigger in `TabsList` (after the Activity trigger):
```tsx
          <TabsTrigger value="invoice-activity">Invoice Activity</TabsTrigger>
```

Add the tab content (after the existing `activity` `TabsContent` block):
```tsx
        {/* ---- Invoice Activity ---- */}
        <TabsContent value="invoice-activity">
          <Card>
            <CardContent className="p-0">
              {invoiceActivity.length === 0 ? (
                <EmptyState title="No invoice activity yet" description="Invoice actions (issue, payment, void, edits) will be recorded here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceActivity.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                        <TableCell className="font-medium">{a.actor_name}</TableCell>
                        <TableCell>{actionLabel(a.action)}</TableCell>
                        <TableCell className="font-mono text-xs">{a.entity_label ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{a.reason ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 4: Build** → Run: `npm run build` → Expected: PASS.

- [ ] **Step 5: Manual smoke** → Visit `/settings/admin` as a Super Admin; the "Invoice Activity" tab lists global events with Who/Action/Invoice/Reason.

- [ ] **Step 6: Commit**

```bash
git add src/data/admin.ts "src/app/(authenticated)/settings/admin/page.tsx" "src/app/(authenticated)/settings/admin/AdminConsoleClient.tsx"
git commit -m "feat(audit): admin Invoice Activity view"
```

---

## Task 14: Integration tests (migration immutability/RLS + action emits a row)

**Files:**
- Create: `src/integration/invoice-activity.integration.test.ts`

**Interfaces:**
- Consumes: integration harness (`src/integration/db.ts`): `connect`, `disconnect`, `begin`, `rollback`, `sql`, `asServiceRole`, `asUser`, `seedUser`, `seedCustomer`, `seedInvoice`.

- [ ] **Step 1: Write the tests**

```typescript
// src/integration/invoice-activity.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { connect, disconnect, begin, rollback, sql, asServiceRole, asUser, seedUser, seedCustomer, seedInvoice } from './db'

beforeAll(connect)
afterAll(disconnect)
beforeEach(begin)
afterEach(rollback)

async function insertRow(invoiceId: string, actorId: string) {
  await asServiceRole(
    `insert into invoice_activity_log (invoice_id, actor_id, actor_name, action, entity_label)
     values ($1, $2, 'Tester', 'invoice.issued', 'INV-X')`,
    [invoiceId, actorId],
  )
}

describe('invoice_activity_log', () => {
  it('is append-only: UPDATE and DELETE raise', async () => {
    const u = await seedUser(['invoices.manage'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)

    await expect(asServiceRole(`update invoice_activity_log set reason = 'x'`)).rejects.toThrow(/append-only/)
    await expect(asServiceRole(`delete from invoice_activity_log`)).rejects.toThrow(/append-only/)
  })

  it('is invisible to authenticated sessions (no RLS policy)', async () => {
    const u = await seedUser(['invoices.view'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)

    const res = await asUser(u, 'select * from invoice_activity_log')
    // RLS with no policy → zero rows for an authenticated session.
    expect(res.ok ? res.rows.length : 0).toBe(0)
  })

  it('accepts inserts and reads back via service role', async () => {
    const u = await seedUser(['invoices.manage'])
    const c = await seedCustomer()
    const inv = await seedInvoice({ customerId: c, createdBy: u, total: 100 })
    await insertRow(inv, u)
    const { rows } = await asServiceRole('select action, actor_name from invoice_activity_log where invoice_id = $1', [inv])
    expect(rows).toEqual([{ action: 'invoice.issued', actor_name: 'Tester' }])
  })
})
```

- [ ] **Step 2: Run integration tests (requires local stack)**

Run: `supabase start` (if not running), then `npm run test:integration -- invoice-activity`
Expected: PASS. (If the local stack is unavailable in this environment, note that and rely on the unit tests + a manual smoke; the migration was applied remotely via MCP in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/integration/invoice-activity.integration.test.ts
git commit -m "test(audit): integration tests for invoice_activity_log immutability + RLS"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full unit suite** → Run: `npm test` → Expected: PASS (all suites).
- [ ] **Step 2: Build** → Run: `npm run build` → Expected: PASS.
- [ ] **Step 3: Manual end-to-end smoke** (dev server, port 6060): create → issue → record payment → edit case → void an invoice; confirm each appears in the per-invoice Activity panel with the correct actor and (for edits) field diffs, and that the `/settings/admin` "Invoice Activity" tab shows the same events globally.
- [ ] **Step 4: Final commit / branch is ready for review** (the work lives on `feat/invoice-audit-logging`).

---

## Self-Review Notes (coverage map)

- **Data model + RLS + append-only + backfill** → Task 1.
- **Reliable actor (actorName)** → Task 2.
- **Capture helper (best-effort)** → Task 3; **diffs** → Task 4; **labels** → Task 5; **relative time** → Task 6.
- **Event catalogue:** create/issue/payment → Task 7; edits (incl. work note) → Task 8; void + admin → Task 9; credits + deletes → Task 10.
- **Per-invoice timeline (merge work-status)** → Tasks 11–12.
- **Admin compliance view** → Task 13.
- **Tests:** unit throughout; integration (immutability/RLS) → Task 14; final gates → Task 15.
