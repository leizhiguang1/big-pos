# Managed Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product `unit` an admin-managed catalog (Settings → Units) and replace the free-typing combobox with a clean dropdown of those units.

**Architecture:** A new `units` managed-list table mirrors `work_stages`/`service_statuses` (RLS gated to `settings.manage`). A new `/settings/units` page (a near-copy of the Work Stages manager, minus color) does CRUD + reorder. The products page fetches active units server-side and passes them to `ProductsClient`, whose unit field becomes a Radix `<Select>`. `products.unit` stays a text string (validated against the list — no FK). The now-unused `Combobox` is deleted.

**Tech Stack:** TypeScript, React 19, Next.js (App Router), Tailwind, Radix UI, react-hook-form + zod, Supabase, vitest.

## Global Constraints

- **No new npm dependencies.**
- **`products.unit` stays a `text` column** (validated against the units list) — no foreign key, no products migration.
- **Units have no color** (unlike work stages / service statuses).
- **RLS for `units` mirrors `work_stages` exactly:** policy `units_read` = `FOR SELECT TO authenticated USING (true)`; policy `units_write` = `FOR ALL TO authenticated USING (auth_has_permission('settings.manage')) WITH CHECK (auth_has_permission('settings.manage'))`. Enable RLS on the table.
- **Tests are vitest pure-logic only** (no React test env). UI/data changes are verified with `npx tsc --noEmit`, `npm run lint`, and `npm run build`; colocated `*.test.ts` using `describe/it/expect`.
- **`strict: false`** in tsconfig: narrow unions with `result.ok === false`, not `!result.ok`.
- **Client components** start with `'use client'`; follow existing `settings/*` and `ui/` conventions.
- **Settings managers use the direct Supabase browser client** (`@/lib/supabase`), RLS-enforced — matching `work-stages`/`service-statuses` (not server actions).
- **Migration naming:** `supabase/migrations/YYYYMMDDHHMMSS_<desc>.sql`.

---

### Task 1: `units` table — migration, types, alias

Create the managed-list table with RLS + seed, regenerate DB types, and add the `Unit` alias. Touches production data, so the controller executes the migration and type regen directly (via the Supabase MCP tools) rather than delegating.

**Files:**
- Create: `supabase/migrations/20260622110000_create_units_table.sql`
- Modify: `src/lib/database-generated.types.ts` (regenerated)
- Modify: `src/lib/database.types.ts` (add `Unit` alias)

**Interfaces:**
- Consumes: the existing SQL helper `auth_has_permission(text)` (used by `work_stages` policies).
- Produces: a `units` table `{ id uuid, label text, sort_order int, is_active boolean, created_at timestamptz }`; the generated `Tables<'units'>` type; `export type Unit = Tables<'units'>`.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260622110000_create_units_table.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `create_units_table` and the SQL above.

- [ ] **Step 3: Verify the table, RLS, and seed**

Run via the Supabase MCP `execute_sql` tool:

```sql
select label, sort_order, is_active from public.units order by sort_order;
select policyname, cmd, qual from pg_policies where tablename = 'units' order by cmd;
```

Expected: 7 rows (`unit`…`pair`, sort_order 10–70, all active); two policies — `units_read` (SELECT, `true`) and `units_write` (ALL, `auth_has_permission('settings.manage')`).

- [ ] **Step 4: Regenerate database types**

Run the Supabase MCP `generate_typescript_types` tool and overwrite `src/lib/database-generated.types.ts` verbatim with its output. Confirm a `units:` table block now appears in it.

- [ ] **Step 5: Add the `Unit` alias**

In `src/lib/database.types.ts`, after the `WorkStage` alias (line 33: `export type WorkStage = Tables<'work_stages'>`), add:

```ts
export type Unit = Tables<'units'>
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add supabase/migrations/20260622110000_create_units_table.sql src/lib/database-generated.types.ts src/lib/database.types.ts
git commit -m "feat(units): add units table (RLS + seed), regenerate types, add Unit alias"
```

---

### Task 2: `getActiveUnits()` data function

Server-side read of active units, ordered for the dropdown. Mirrors `getProducts`. No unit test (thin Supabase query, like `getProducts`) — verified by typecheck.

**Files:**
- Modify: `src/data/products.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; the `Unit` type from Task 1.
- Produces: `export async function getActiveUnits(): Promise<Unit[]>` — active units ordered by `sort_order`.

- [ ] **Step 1: Add the import and function**

In `src/data/products.ts`, change the type import (line 10) from:

```ts
import type { Product } from '@/lib/database.types'
```

to:

```ts
import type { Product, Unit } from '@/lib/database.types'
```

Then append at the end of the file:

```ts
// Active units for the product form's unit dropdown, ordered for display.
// Inactive units are excluded; a product already using a now-inactive unit
// keeps it via the form's option-preservation (see buildUnitOptions).
export async function getActiveUnits(): Promise<Unit[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('units')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  return (data ?? []) as Unit[]
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/data/products.ts
git commit -m "feat(units): add getActiveUnits() server query"
```

---

### Task 3: Settings → Units manager page + nav entry

A new `/settings/units` page mirroring the Work Stages manager (minus color, plus row-action tooltips), and one route-registry entry so it appears in the settings nav and is deep-link guarded.

**Files:**
- Create: `src/app/(authenticated)/settings/units/page.tsx`
- Modify: `src/domain/navigation.ts`

**Interfaces:**
- Consumes: `Unit` type (Task 1); the `units` table RLS (Task 1); `supabase` browser client; existing `ui/*` components.
- Produces: a reachable, permission-gated `/settings/units` admin page.

- [ ] **Step 1: Add the nav entry**

In `src/domain/navigation.ts`, add `Ruler` to the lucide import (line 11-14 block) — change:

```ts
import {
  LayoutDashboard, Users, FileText, Wrench, Package, BarChart3,
  ClipboardList, ListChecks, UserCog, ShieldCheck,
} from 'lucide-react'
```

to:

```ts
import {
  LayoutDashboard, Users, FileText, Wrench, Package, BarChart3,
  ClipboardList, ListChecks, UserCog, ShieldCheck, Ruler,
} from 'lucide-react'
```

Then add a Units entry to the `NAV` array immediately after the Work Stages line (line 45):

```ts
  { href: '/settings/units', label: 'Units', icon: Ruler, area: 'settings', group: 'Lab Setup', permission: 'settings.manage' },
```

- [ ] **Step 2: Create the Units manager page**

Create `src/app/(authenticated)/settings/units/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ArrowLeft, Plus, Pencil, ToggleLeft, ToggleRight, ArrowUp, ArrowDown } from 'lucide-react'
import type { Unit } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'

const schema = z.object({
  label: z.string().min(1, 'Label is required').max(40, 'Keep it short'),
})
type FormData = z.infer<typeof schema>

export default function UnitsPage() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('settings.manage')
  const [rows, setRows] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Unit | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { label: '' },
  })

  const load = () =>
    supabase
      .from('units')
      .select('*')
      .order('sort_order')
      .order('label')
      .then(({ data }) => {
        setRows(data ?? [])
        setLoading(false)
      })

  useEffect(() => { load() }, [])

  const openNew = () => {
    setEditing(null)
    setError(null)
    reset({ label: '' })
    setOpen(true)
  }

  const openEdit = (u: Unit) => {
    setEditing(u)
    setError(null)
    reset({ label: u.label })
    setOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    if (editing) {
      const { error } = await supabase
        .from('units')
        .update({ label: data.label.trim() })
        .eq('id', editing.id)
      if (error) setError(error.message)
    } else {
      const nextOrder = (rows.at(-1)?.sort_order ?? 0) + 10
      const { error } = await supabase.from('units').insert({
        label: data.label.trim(),
        sort_order: nextOrder,
        is_active: true,
      })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) {
      setOpen(false)
      load()
    }
  }

  const toggleActive = async (u: Unit) => {
    await supabase.from('units').update({ is_active: !u.is_active }).eq('id', u.id)
    load()
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = rows[index + dir]
    const current = rows[index]
    if (!target || !current) return
    await Promise.all([
      supabase.from('units').update({ sort_order: target.sort_order }).eq('id', current.id),
      supabase.from('units').update({ sort_order: current.sort_order }).eq('id', target.id),
    ])
    load()
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Units</h1>
            <p className="text-sm text-gray-500 mt-0.5">Units of measure for products (per tooth, per arch, per case…).</p>
          </div>
        </div>
        {canEdit && <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Unit</Button>}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Order</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">No units yet</TableCell></TableRow>}
              {rows.map((u, i) => (
                <TableRow key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Move up</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Move down</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{u.label}</TableCell>
                  <TableCell className="text-sm text-gray-500">{u.is_active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit unit" onClick={() => openEdit(u)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit unit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={u.is_active ? 'Deactivate unit' : 'Activate unit'} onClick={() => toggleActive(u)}>
                              {u.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{u.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Unit' : 'New Unit'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input placeholder="e.g. tooth" {...register('label')} />
              {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Unit'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/settings/units/page.tsx src/domain/navigation.ts
git commit -m "feat(units): Settings → Units manager page + nav entry"
```

---

### Task 4: `buildUnitOptions` pure helper (TDD)

The product unit dropdown must show the active units, plus the editing product's current unit when it isn't active (so editing a product whose unit was deactivated/renamed never drops it). Isolate that as a pure, tested helper.

**Files:**
- Create: `src/lib/units.ts`
- Test: `src/lib/units.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function buildUnitOptions(active: string[], current?: string | null): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/units.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildUnitOptions } from './units'

describe('buildUnitOptions', () => {
  it('returns the active labels when current is already among them', () => {
    expect(buildUnitOptions(['unit', 'tooth'], 'tooth')).toEqual(['unit', 'tooth'])
  })
  it('appends current when it is not in the active list', () => {
    expect(buildUnitOptions(['unit', 'tooth'], 'bridge')).toEqual(['unit', 'tooth', 'bridge'])
  })
  it('returns active unchanged for empty, null, or undefined current', () => {
    expect(buildUnitOptions(['unit', 'tooth'], '')).toEqual(['unit', 'tooth'])
    expect(buildUnitOptions(['unit', 'tooth'], null)).toEqual(['unit', 'tooth'])
    expect(buildUnitOptions(['unit', 'tooth'], undefined)).toEqual(['unit', 'tooth'])
  })
  it('handles an empty active list', () => {
    expect(buildUnitOptions([], 'set')).toEqual(['set'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/units.test.ts`
Expected: FAIL — cannot find module `./units` / `buildUnitOptions` not defined.

- [ ] **Step 3: Implement the helper**

Create `src/lib/units.ts`:

```ts
/**
 * Option list for the product unit dropdown: the active unit labels, plus the
 * product's current value appended when it isn't among them (e.g. the unit was
 * deactivated or renamed). Keeps editing from silently dropping a stored unit.
 */
export function buildUnitOptions(active: string[], current?: string | null): string[] {
  if (current && !active.includes(current)) return [...active, current]
  return active
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/units.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/units.ts src/lib/units.test.ts
git commit -m "feat(units): add buildUnitOptions helper (preserve current unit)"
```

---

### Task 5: Product form → unit `<Select>`; delete Combobox

Wire active units through the products page into `ProductsClient`, replace the unit combobox with a Radix `<Select>` (preserving the current value on edit and defaulting sensibly), and delete the now-unused `Combobox` + `UNIT_OPTIONS`.

**Files:**
- Modify: `src/app/(authenticated)/products/page.tsx`
- Modify: `src/components/products/ProductsClient.tsx`
- Delete: `src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `getActiveUnits` (Task 2), `Unit` type (Task 1), `buildUnitOptions` (Task 4), the existing `<Select>` family from `@/components/ui/select`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Fetch units and pass them in (`products/page.tsx`)**

Replace the entire contents of `src/app/(authenticated)/products/page.tsx` with:

```tsx
import { getProducts, getActiveUnits } from '@/data/products'
import { ProductsClient } from '@/components/products/ProductsClient'

export default async function ProductsPage() {
  const [products, units] = await Promise.all([getProducts(), getActiveUnits()])
  return <ProductsClient products={products} units={units} />
}
```

- [ ] **Step 2: Update imports in `ProductsClient.tsx`**

In `src/components/products/ProductsClient.tsx`:

Remove the `Combobox` import (line 16): `import { Combobox } from '@/components/ui/combobox'`.

Add these imports (place after the `Pagination` import on line 19):

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { buildUnitOptions } from '@/lib/units'
```

Change the `Product` type import (line 22) from:

```tsx
import type { Product } from '@/lib/database.types'
```

to:

```tsx
import type { Product, Unit } from '@/lib/database.types'
```

- [ ] **Step 3: Remove the `UNIT_OPTIONS` constant**

Delete the constant and its comment (lines 28-30):

```tsx
// Common dental-lab units (stored as bare nouns; rendered as "per {unit}").
// The combobox still accepts a custom typed value.
const UNIT_OPTIONS = ['unit', 'tooth', 'arch', 'quadrant', 'case', 'set', 'pair']
```

(Leave `productMatchesQuery` below it untouched — it still searches `p.unit`.)

- [ ] **Step 4: Accept the `units` prop and derive the default**

Change the component signature (line 85) from:

```tsx
export function ProductsClient({ products }: { products: Product[] }) {
```

to:

```tsx
export function ProductsClient({ products, units }: { products: Product[]; units: Unit[] }) {
```

Immediately after `const canEdit = hasPermission('products.edit')` (line 88), add:

```tsx
  const unitLabels = units.map(u => u.label)
  const defaultUnit = unitLabels.includes('unit') ? 'unit' : (unitLabels[0] ?? 'unit')
```

- [ ] **Step 5: Use `defaultUnit` for the form defaults**

In the `useForm` `defaultValues` (line 97), change `unit: 'unit'` to `unit: defaultUnit`.

In `openNew`'s `reset({...})` (line 122), change `unit: 'unit',` to `unit: defaultUnit,`.

(`openEdit` keeps `unit: p.unit` — the stored value.)

- [ ] **Step 6: Replace the unit field with a `<Select>`**

Replace the unit form field block (lines 319-339, the `<div className="space-y-2">` containing `<Label>Unit *</Label>` … through its closing `</div>` before `<DialogFooter>`) with:

```tsx
            <div className="space-y-2">
              <Label>Unit *</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">per</span>
                <div className="flex-1">
                  <Controller
                    control={control}
                    name="unit"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {buildUnitOptions(unitLabels, field.value).map(u => (
                            <SelectItem key={u} value={u}>
                              {unitLabels.includes(u) ? u : `${u} (inactive)`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
```

- [ ] **Step 7: Delete the unused Combobox component**

```bash
git rm src/components/ui/combobox.tsx
```

- [ ] **Step 8: Verify nothing else references Combobox/UNIT_OPTIONS**

Run: `grep -rn "Combobox\|UNIT_OPTIONS" src/`
Expected: only the unrelated comment in `src/components/invoices/ProductSearchAdd.tsx` (`// has no Command/Combobox/Popover primitive.`). No imports, no JSX, no constant.

- [ ] **Step 9: Typecheck, lint, and run the suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type/lint errors; all vitest tests pass (including Task 4's `units.test.ts`).

- [ ] **Step 10: Commit**

```bash
git add src/app/\(authenticated\)/products/page.tsx src/components/products/ProductsClient.tsx
git commit -m "feat(products): unit field as Select from managed units; remove Combobox"
```

---

### Task 6: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds, no type errors. (`/settings/units` and `/products` both compile.)

- [ ] **Step 2: Manual verification (dev server)**

Run `npm run dev`, sign in as a `settings.manage` user, and confirm:
- **Settings → Units** appears under "Lab Setup"; the page lists the 7 seeded units. Add `bridge`, rename it, reorder it (↑/↓), deactivate it — the table updates; hover tooltips show on the action buttons.
- A user **without** `settings.manage` cannot see the Units nav entry and is blocked from `/settings/units` (deep-link guard).
- **Products → Add Product:** the Unit field is a `per [ dropdown ]` of active units (no free typing); a unit just added in Settings appears in it; saving stores the label and the table shows `per {unit}`.
- **Edit a product** whose unit you deactivated in Settings: the field still shows that value (rendered `… (inactive)`) and editing preserves it.

- [ ] **Step 3: Final confirmation**

No commit needed. If a defect surfaces, fix it under the relevant task and re-run Steps 1-2.

---

## Self-Review

**Spec coverage:**
- Part 1 (`units` table + RLS + seed + types): Task 1. ✓
- Part 2 (Settings → Units manager + nav entry, with row-action tooltips): Task 3. ✓
- Part 3 (product field → Select, server-fetched units, preserve current value, sensible default): Tasks 2, 4, 5. ✓
- Part 4 (delete Combobox + UNIT_OPTIONS): Task 5 (steps 2, 3, 7, 8). ✓
- Decisions: `products.unit` stays text (no FK) — no products migration in any task ✓; Combobox removed ✓.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command states expected output.

**Type consistency:** `Unit = Tables<'units'>` defined in Task 1 and consumed by Tasks 2/3/5. `getActiveUnits(): Promise<Unit[]>` (Task 2) is consumed by `products/page.tsx` (Task 5) and passed as `units: Unit[]` to `ProductsClient` (Task 5 signature). `buildUnitOptions(active, current)` (Task 4) is called in Task 5 step 6 with `(unitLabels, field.value)`. `<Select>`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` match the exports in `src/components/ui/select.tsx`. RLS policy names/shape match `work_stages`. Consistent.
