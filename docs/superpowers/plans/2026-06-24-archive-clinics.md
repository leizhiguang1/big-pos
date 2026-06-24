# Archive (soft-delete) Clinics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users archive (soft-delete) a clinic so it disappears from the directory, global search, and the new-invoice picker, while all historical invoices/statements/reports stay intact — fully reversible via Restore.

**Architecture:** Add a nullable `archived_at timestamptz` column to `customers` (`NULL` = active). Two new Server Actions (`archiveCustomerAction`/`restoreCustomerAction`) toggle it, gated on `customers.edit`. Read queries that feed live pickers/lists filter `archived_at IS NULL`; historical reads (by `customer_id`) are untouched. The detail-page header gains Archive/Restore controls and the directory gains an "Archived" view toggle.

**Tech Stack:** Next.js (App Router, Server Components + Server Actions), Supabase (Postgres + RLS), TypeScript (`strict: false`), vitest (unit + raw-pg integration via `npm run test:integration`).

## Global Constraints

- UI copy always says **"Clinic"**; code/DB/routes/types/permission keys stay `customer` (docs/CONVENTIONS.md).
- Server Actions follow the existing pattern: `requirePermission(...)` → `if (gate.ok === false) return gate` → validate → `createAdminClient()` → mutate → `revalidatePath(...)` → return `ActionResult`.
- Under `strict: false`, narrow union results with `=== false` (e.g. `gate.ok === false`), never `!gate.ok`.
- No new permission key — archive/restore reuse `customers.edit`.
- Archive-only: never hard-`DELETE` a clinic.
- Dev server runs on port 6060 (`npm run dev`).

---

### Task 1: Add `archived_at` column + regenerate types

**Files:**
- Create: `supabase/migrations/20260624120000_clinic_archived_at.sql`
- Modify: `src/lib/database-generated.types.ts` (regenerated `customers` Row/Insert/Update)
- Test: `src/integration/archive-clinics.integration.test.ts`

**Interfaces:**
- Produces: `customers.archived_at timestamptz NULL`; `Customer` type (`Tables<'customers'>`, re-exported from `src/lib/database.types.ts:35`) gains `archived_at: string | null`.

- [ ] **Step 1: Write the failing integration test**

Create `src/integration/archive-clinics.integration.test.ts`:

```typescript
// Integration tests for clinic soft-delete (archived_at).
// Raw-pg harness: see ./db.ts. asUser() runs as an authenticated user
// (auth.uid()); seeding runs as the postgres superuser.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { connect, disconnect, begin, rollback, sql, asUser, seedUser, seedCustomer } from './db'

beforeAll(connect)
afterAll(disconnect)
beforeEach(begin)
afterEach(rollback)

describe('clinic archive: column + gating', () => {
  it('customers.archived_at exists and defaults to NULL', async () => {
    const id = await seedCustomer('Fresh Clinic')
    const res = await sql('select archived_at from customers where id = $1', [id])
    expect(res.rows[0].archived_at).toBeNull()
  })

  it('a customers.edit holder can archive and restore (set/clear archived_at)', async () => {
    const editor = await seedUser(['customers.view', 'customers.edit'])
    const id = await seedCustomer('Archivable')

    const archive = await asUser(editor, 'update customers set archived_at = now() where id = $1 returning archived_at', [id])
    expect(archive.ok).toBe(true)
    if (archive.ok) expect(archive.rows[0].archived_at).not.toBeNull()

    const restore = await asUser(editor, 'update customers set archived_at = null where id = $1 returning archived_at', [id])
    expect(restore.ok).toBe(true)
    if (restore.ok) expect(restore.rows[0].archived_at).toBeNull()
  })

  it('a view-only user cannot archive (RLS denies the update)', async () => {
    const viewer = await seedUser(['customers.view'])
    const id = await seedCustomer('Protected')
    const res = await asUser(viewer, 'update customers set archived_at = now() where id = $1 returning id', [id])
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.error).toMatch(/row-level security/i)
  })
})

describe('clinic archive: filter predicate', () => {
  it('archived_at IS NULL excludes archived clinics', async () => {
    const active = await seedCustomer('Active One')
    const archived = await seedCustomer('Archived One')
    await sql('update customers set archived_at = now() where id = $1', [archived])

    const res = await sql('select id from customers where archived_at is null and id = any($1)', [[active, archived]])
    const ids = res.rows.map((r: { id: string }) => r.id)
    expect(ids).toContain(active)
    expect(ids).not.toContain(archived)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- archive-clinics`
Expected: FAIL — `column "archived_at" does not exist` (the migration isn't applied yet).

> If the local stack isn't running, start it first: `supabase start`. The integration suite needs the migrations applied to the local DB.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260624120000_clinic_archived_at.sql`:

```sql
-- Clinic soft-delete. NULL = active; a timestamp = archived (records when).
-- No backfill (existing clinics stay active). No RLS change: writes use the
-- service-role/admin client; the existing customers UPDATE policy already gates
-- on customers.edit, so toggling archived_at is gated like any other update.
-- FK constraints unchanged — ON DELETE RESTRICT becomes an unreachable backstop
-- since we never hard-delete.
alter table public.customers
  add column if not exists archived_at timestamptz;

-- Partial index: the directory/pickers filter on the active set, which is the
-- hot path and (over time) the minority once clinics get archived.
create index if not exists idx_customers_active
  on public.customers (clinic_name)
  where archived_at is null;
```

- [ ] **Step 4: Apply the migration to the local DB**

Run: `supabase migration up` (or `supabase db reset` if you prefer a clean rebuild).
Expected: migration `20260624120000_clinic_archived_at` applied, no errors.

- [ ] **Step 5: Regenerate TypeScript types**

Run the project's type-generation workflow (see memory `supabase-types-workflow`), e.g.:
`supabase gen types typescript --local > src/lib/database-generated.types.ts`
Expected: the `customers` `Row` block now contains `archived_at: string | null`, and `Insert`/`Update` contain `archived_at?: string | null`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:integration -- archive-clinics`
Expected: PASS (all four tests).

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260624120000_clinic_archived_at.sql src/lib/database-generated.types.ts src/integration/archive-clinics.integration.test.ts
git commit -m "feat(clinics): add archived_at column for soft-delete"
```

---

### Task 2: Archive / restore Server Actions

**Files:**
- Modify: `src/data/customer-actions.ts` (append two actions)

**Interfaces:**
- Consumes: `requirePermission` (`@/lib/auth/require-permission`), `createAdminClient` (`@/lib/supabase/admin`), `revalidatePath` (`next/cache`), existing `ActionResult` type in this file.
- Produces:
  - `archiveCustomerAction(id: string): Promise<ActionResult>` — sets `archived_at = now()`.
  - `restoreCustomerAction(id: string): Promise<ActionResult>` — sets `archived_at = null`.
  - The DB-level gate for both is proven by Task 1's RLS test (UPDATE requires `customers.edit`); these actions add the matching server-side gate so the UI fails fast with a clean `ActionResult` error.

- [ ] **Step 1: Add the two actions**

Append to `src/data/customer-actions.ts` (after `updateCustomerAction`):

```typescript
// Soft-delete: archive hides a clinic from the directory, global search, and the
// new-invoice picker, but keeps all historical invoices/statements intact. Gated
// on customers.edit (same as create/update) — no separate delete permission.
export async function archiveCustomerAction(id: string): Promise<ActionResult> {
  const gate = await requirePermission('customers.edit')
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { error } = await admin
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}

export async function restoreCustomerAction(id: string): Promise<ActionResult> {
  const gate = await requirePermission('customers.edit')
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { error } = await admin
    .from('customers')
    .update({ archived_at: null })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `archived_at` is now a known column on the `customers` Update type from Task 1.)

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/data/customer-actions.ts
git commit -m "feat(clinics): add archive/restore server actions"
```

---

### Task 3: Hide archived clinics from live reads

**Files:**
- Modify: `src/data/customers.ts` — `getCustomers()` and `getCustomersPage()`
- Modify: `src/data/invoices.ts` — `getInvoiceFormData()` (add optional `includeCustomerId`)
- Modify: `src/app/(authenticated)/invoices/[id]/edit/page.tsx` — pass the edited invoice's clinic to the picker
- Test: extend `src/integration/archive-clinics.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's `archived_at` column; `CustomerListParams` (existing, in `src/data/customers.ts`).
- Produces:
  - `getCustomers()` returns active clinics only.
  - `getCustomersPage(params)` — `CustomerListParams` gains `archived?: boolean`; `false`/absent → active only, `true` → archived only.
  - `getInvoiceFormData(opts?: { includeCustomerId?: string })` — picker returns active clinics, plus the one clinic named by `includeCustomerId` even if archived (so editing an invoice whose clinic was archived still shows its name).

- [ ] **Step 1: Add the failing filter integration tests**

Append to `src/integration/archive-clinics.integration.test.ts`:

```typescript
describe('clinic archive: invoice picker inclusion', () => {
  it('active OR a specific included id passes the picker filter', async () => {
    const active = await seedCustomer('Picker Active')
    const archivedSelected = await seedCustomer('Picker Archived Selected')
    const archivedOther = await seedCustomer('Picker Archived Other')
    await sql('update customers set archived_at = now() where id = any($1)', [[archivedSelected, archivedOther]])

    // Mirrors getInvoiceFormData({ includeCustomerId: archivedSelected }).
    const res = await sql(
      'select id from customers where (archived_at is null or id = $1) and id = any($2)',
      [archivedSelected, [active, archivedSelected, archivedOther]],
    )
    const ids = res.rows.map((r: { id: string }) => r.id)
    expect(ids).toContain(active)
    expect(ids).toContain(archivedSelected)
    expect(ids).not.toContain(archivedOther)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- archive-clinics`
Expected: the new `invoice picker inclusion` test is the only addition; it should PASS as raw SQL even before TS changes (it validates the predicate we are about to implement). Treat this as the contract for Steps 3–5. Proceed to wire the TS.

> Note: the TS query builders (`getCustomers`, `getCustomersPage`, `getInvoiceFormData`) have no existing unit/mocking harness in this repo — they are verified by this SQL contract test plus `tsc`. Do not introduce a Supabase-client mock.

- [ ] **Step 3: Filter `getCustomers()` to active**

In `src/data/customers.ts`, change `getCustomers()`:

```typescript
export async function getCustomers(): Promise<Customer[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('customers')
    .select('*')
    .is('archived_at', null)
    .order('clinic_name')
  return (data ?? []) as Customer[]
}
```

- [ ] **Step 4: Add an `archived` filter to `getCustomersPage()`**

In `src/data/customers.ts`, extend `CustomerListParams` and the query. Add the field to the interface:

```typescript
export interface CustomerListParams {
  q?: string
  page?: number
  pageSize?: number
  sort?: string | null
  dir?: 'asc' | 'desc'
  archived?: boolean
}
```

Then in `getCustomersPage`, destructure `archived = false` and apply it right after the `.order(...)` line, before the search `if (term)` block:

```typescript
  const { q = '', page = 1, pageSize = 15, sort = null, dir = 'asc', archived = false } = params
  // ... existing supabase / sortCol setup ...
  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: dir !== 'desc' })

  // Active view (default) hides archived clinics; the "Archived" view shows only them.
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null)
```

(Leave the rest of `getCustomersPage` unchanged.)

- [ ] **Step 5: Filter the invoice picker, with an opt-in include**

In `src/data/invoices.ts`, change `getInvoiceFormData`'s signature and the customers query:

```typescript
export async function getInvoiceFormData(
  opts?: { includeCustomerId?: string },
): Promise<InvoiceFormData> {
  const supabase = await createClient()

  // Picker shows active clinics only — you can't bill an archived clinic. In
  // edit mode we also include the invoice's own clinic (even if archived) so the
  // dropdown still shows its name.
  let customersQuery = supabase.from('customers').select('*')
  customersQuery = opts?.includeCustomerId
    ? customersQuery.or(`archived_at.is.null,id.eq.${opts.includeCustomerId}`)
    : customersQuery.is('archived_at', null)
  customersQuery = customersQuery.order('clinic_name')

  const [cRes, pRes, ssRes, billingSettings] = await Promise.all([
    customersQuery,
    supabase.from('products').select('*').eq('active', true).order('created_at'),
    supabase.from('service_statuses').select('*').eq('is_active', true).order('sort_order').order('label'),
    getBillingSettings(),
  ])
  return {
    customers: (cRes.data ?? []) as Customer[],
    products: (pRes.data ?? []) as Product[],
    serviceStatuses: (ssRes.data ?? []) as ServiceStatus[],
    paymentTermsDays: billingSettings.paymentTermsDays,
  }
}
```

- [ ] **Step 6: Pass the edited invoice's clinic into the picker**

In `src/app/(authenticated)/invoices/[id]/edit/page.tsx`, fetch the invoice first so its `customer_id` can seed the picker include (the new-invoice page is unchanged and still calls `getInvoiceFormData()` with no args):

```typescript
  const editData = await getInvoiceForEdit(id)
  if (!editData) notFound()
  const formData = await getInvoiceFormData({ includeCustomerId: editData.invoice.customer_id })
  return <InvoiceForm invoiceId={id} formData={formData} editData={editData} />
```

(Remove the previous `Promise.all([...])` that fetched both together.)

- [ ] **Step 7: Run the integration test + typecheck + lint**

Run: `npm run test:integration -- archive-clinics`
Expected: PASS (all tests, including the picker-inclusion contract).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/data/customers.ts src/data/invoices.ts "src/app/(authenticated)/invoices/[id]/edit/page.tsx" src/integration/archive-clinics.integration.test.ts
git commit -m "feat(clinics): hide archived clinics from directory, search, and invoice picker"
```

---

### Task 4: Archive/Restore UI on the clinic detail page + Archived directory view

**Files:**
- Create: `src/components/customers/ArchiveClinicControls.tsx`
- Modify: `src/components/customers/CustomerDetailHeader.tsx` (render the controls + handle archived state)
- Modify: `src/app/(authenticated)/customers/[id]/page.tsx` (pass `archivedAt` to the header)
- Modify: `src/app/(authenticated)/customers/page.tsx` (read `archived` URL param)
- Modify: `src/components/customers/CustomerListClient.tsx` (Archived view toggle + archived empty state)

**Interfaces:**
- Consumes: `archiveCustomerAction`, `restoreCustomerAction` (Task 2); `getCustomersPage({ archived })` (Task 3); `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` (`@/components/ui/dialog`), `useToast` (`@/components/feedback/toast`), `Badge` (`@/components/ui/badge`) — same primitives the void flow uses in `ActionsBar.tsx`.
- Produces: `ArchiveClinicControls({ id, archived }: { id: string; archived: boolean })` — a client component rendering either an Archive button (+ confirm dialog) or a Restore button, calling the actions and `router.refresh()` on success.

- [ ] **Step 1: Create the Archive/Restore controls component**

Create `src/components/customers/ArchiveClinicControls.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/feedback/toast'
import { Archive, ArchiveRestore } from 'lucide-react'
import { archiveCustomerAction, restoreCustomerAction } from '@/data/customer-actions'

// Archive = soft-delete (hide from lists/pickers, keep history). Restore = undo.
// Both gated server-side on customers.edit; this island is only rendered when the
// signed-in user holds that permission (see CustomerDetailHeader).
export function ArchiveClinicControls({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter()
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function runArchive() {
    setBusy(true)
    try {
      const res = await archiveCustomerAction(id)
      if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
      setOpen(false)
      show({ variant: 'success', title: 'Clinic archived' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function runRestore() {
    setBusy(true)
    try {
      const res = await restoreCustomerAction(id)
      if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
      show({ variant: 'success', title: 'Clinic restored' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (archived) {
    return (
      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={runRestore} disabled={busy}>
        <ArchiveRestore className="h-4 w-4 mr-2" />{busy ? 'Restoring…' : 'Restore'}
      </Button>
    )
  }

  return (
    <>
      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4 mr-2" />Archive
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" /> Archive Clinic
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive this clinic? It will be hidden from the clinic list and new invoices.
            Existing invoices and statements are kept, and you can restore it later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={runArchive} disabled={busy}>{busy ? 'Archiving…' : 'Yes, Archive'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

> Toast API confirmed: `useToast().show({ title, variant })` with `variant: 'default' | 'success' | 'error'` (`src/components/feedback/toast.tsx`), matching the `ActionsBar.tsx` void flow.

- [ ] **Step 2: Wire the controls into the detail header (and handle archived state)**

In `src/components/customers/CustomerDetailHeader.tsx`: add an `archivedAt` prop, render an "Archived" badge next to the title when set, hide Edit/New-Invoice when archived, and render `ArchiveClinicControls`.

Update the imports and signature:

```tsx
import { Badge } from '@/components/ui/badge'
import { ArchiveClinicControls } from '@/components/customers/ArchiveClinicControls'
// ...existing imports (Link, useRouter, Button, icons, useAuth)

export function CustomerDetailHeader({
  id,
  clinicName,
  contactPerson,
  archivedAt,
}: {
  id: string
  clinicName: string
  contactPerson: string | null
  archivedAt: string | null
}) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const archived = archivedAt !== null
```

Replace the title block to show the badge:

```tsx
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{clinicName}</h1>
            {archived && <Badge variant="secondary" className="uppercase">Archived</Badge>}
          </div>
          {contactPerson && <p className="text-sm text-muted-foreground mt-0.5">{contactPerson}</p>}
        </div>
```

Replace the actions block so archived clinics only expose Statement + Restore, while active clinics keep Edit/New-Invoice and gain Archive:

```tsx
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        {!archived && hasPermission('customers.edit') && (
          <Button className="w-full sm:w-auto" variant="outline" size="sm" asChild>
            <Link href={`/customers/${id}/edit`}><Edit className="h-4 w-4 mr-2" />Edit</Link>
          </Button>
        )}
        <Button className="w-full sm:w-auto" variant="outline" size="sm" asChild>
          <Link href={`/customers/${id}/statement`}><FileText className="h-4 w-4 mr-2" />Statement</Link>
        </Button>
        {!archived && hasPermission('invoices.create') && (
          <Button className="col-span-2 w-full sm:col-span-1 sm:w-auto" size="sm" asChild>
            <Link href={`/invoices/new?customer=${id}`}><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
          </Button>
        )}
        {hasPermission('customers.edit') && <ArchiveClinicControls id={id} archived={archived} />}
      </div>
```

- [ ] **Step 3: Pass `archivedAt` from the detail page**

In `src/app/(authenticated)/customers/[id]/page.tsx`, update the header render:

```tsx
      <CustomerDetailHeader id={id} clinicName={customer.clinic_name} contactPerson={customer.contact_person} archivedAt={customer.archived_at} />
```

- [ ] **Step 4: Read the `archived` URL param on the directory page**

In `src/app/(authenticated)/customers/page.tsx`, pass it through to the query:

```tsx
  const sp = await searchParams
  const state = parseListSearchParams(sp, '')
  const archived = sp.archived === '1'
  const page = await getCustomersPage({ q: state.q, page: state.page, sort: state.sort, dir: state.dir, archived })
  return <CustomerListClient page={page} state={state} archived={archived} />
```

- [ ] **Step 5: Add the Archived view toggle to the list client**

In `src/components/customers/CustomerListClient.tsx`:

Add `useSearchParams` to the `next/navigation` import and accept the new prop:

```tsx
import { useRouter, useSearchParams } from 'next/navigation'
import { Archive } from 'lucide-react'
// ...

export function CustomerListClient({ page, state, archived }: { page: CustomerListPage; state: ListUrlState; archived: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // ...existing hooks...

  function toggleArchived() {
    const params = new URLSearchParams(searchParams.toString())
    if (archived) params.delete('archived')
    else params.set('archived', '1')
    params.delete('page') // reset pagination when switching views
    router.push(`/customers?${params.toString()}`)
  }
```

In the header action row (next to "New Clinic"), add the toggle button so it shows for everyone:

```tsx
        <div className="flex w-full gap-2 sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto" onClick={toggleArchived}>
            <Archive className="h-4 w-4 mr-2" />{archived ? 'Show active' : 'Show archived'}
          </Button>
          {!archived && hasPermission('customers.edit') && (
            <Button className="w-full sm:w-auto" asChild>
              <Link href="/customers/new"><Plus className="h-4 w-4 mr-2" />New Clinic</Link>
            </Button>
          )}
        </div>
```

Update the subtitle and empty-state copy to reflect the view:

```tsx
          <p className="text-sm text-muted-foreground mt-0.5">{page.total} {archived ? 'archived' : 'registered'}</p>
```

```tsx
      title={archived ? 'No archived clinics' : (view === 'empty-no-results' ? 'No clinics match your search' : 'No clinics yet')}
      description={archived ? 'Clinics you archive will appear here.' : (view === 'empty-no-results' ? 'Try a different search term.' : 'Add your first clinic to get started.')}
```

- [ ] **Step 6: Verify in the running app**

Run: `npm run dev` (port 6060). As a user with `customers.edit`:
1. Open a clinic detail page → click **Archive** → confirm. Toast shows; header now shows the **Archived** badge and a **Restore** button; Edit/New-Invoice are gone.
2. Go to **Clinics** → the archived clinic is absent from the default list. Click **Show archived** → it appears. Click **Restore** (from detail) → it returns to the active list.
3. Start a **New Invoice** → the archived clinic is not in the clinic picker. Open an existing invoice for that clinic in **edit** → the clinic name still shows in the dropdown.

Expected: all behaviors as described; no console errors.

- [ ] **Step 7: Run typecheck + lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/customers/ArchiveClinicControls.tsx src/components/customers/CustomerDetailHeader.tsx "src/app/(authenticated)/customers/[id]/page.tsx" "src/app/(authenticated)/customers/page.tsx" src/components/customers/CustomerListClient.tsx
git commit -m "feat(clinics): archive/restore controls + archived directory view"
```

---

## Verification (whole feature)

- [ ] `npm run test:integration -- archive-clinics` — all archive tests pass.
- [ ] `npm run test` — existing unit suite still passes (no regressions).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean.
- [ ] Manual smoke (Task 4, Step 6) confirmed.

## Notes / known limitations

- Toast API and `@/components/ui/badge` (with `variant="secondary"`) and the `seedCustomer`/`seedUser`/`asUser`/`sql` integration helpers are all confirmed present — no guesses remain.
- This migration is additive and must be applied to prod before the deploy that ships the code (the queries reference `archived_at`). It has no dependency on other pending migrations.
