# Product Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the products page — store `unit` as a clean bare noun entered via a reusable combobox, add hover tooltips to the row action buttons, and add reusable client-side search + pagination.

**Architecture:** Next.js App Router, server-first. The products list is a Server Component ([`products/page.tsx`](../../../src/app/(authenticated)/products/page.tsx)) that fetches all rows and passes them to the `ProductsClient` client island. Writes go through permission-gated Server Actions that re-validate with the shared `productInputSchema` (so adding a normalization transform there governs all writes). Search/pagination is client-side (matches the existing "load all + filter in `useMemo`" pattern) via three new reusable pieces: a pure `paginate()` helper, a `usePaginatedList` hook, and `<ListToolbar>` / `<Pagination>` components.

**Tech Stack:** TypeScript, React 19, Next.js (App Router), Tailwind, Radix UI primitives, react-hook-form + zod, lucide-react icons, Supabase, vitest.

## Global Constraints

- **No new npm dependencies.** Combobox uses plain React + Tailwind; tooltip + popover Radix packages are already installed.
- **Tests are pure-logic only** (vitest, node env — no React Testing Library / jsdom in this repo). Unit-test pure functions; verify React/UI changes with `npx tsc --noEmit`, `npm run lint`, and manual browser checks.
- **Test files are colocated** as `*.test.ts` next to the source (e.g. `src/domain/schemas.test.ts`), using `describe/it/expect` from `vitest`.
- **`strict: false`** in tsconfig: when checking an `ActionResult` union, use `result.ok === false` (not `!result.ok`) — `!` does not narrow under `strict:false`.
- **Follow existing UI conventions:** `'use client'` directive on client components, `cn()` from `@/lib/utils` for class merging, `forwardRef` + `displayName` where the existing `ui/` components do.
- **Match the existing tooltip mounting pattern** from [`EmployeesManager.tsx:82`](../../../src/components/employees/EmployeesManager.tsx#L82): `<TooltipProvider delayDuration={200}>` wrapping the component root.
- **Migration naming:** `supabase/migrations/YYYYMMDDHHMMSS_<desc>.sql` (latest existing is `20260622000000_…`).

---

### Task 1: Normalize existing `products.unit` data (migration)

Strip the redundant `per ` prefix from existing rows so they become bare lowercase nouns (`per set`→`set`, `per unit`→`unit`, `per arch`→`arch`). Must run **before** the display change (Task 8) ships, otherwise the new `per {unit}` rendering would show "per per set". Old code tolerates the migrated values (it shows the bare noun until the new code lands).

**Files:**
- Create: `supabase/migrations/20260622100000_normalize_product_unit.sql`

**Interfaces:**
- Consumes: nothing
- Produces: DB rows with normalized `unit` values (no behavior contract for later tasks)

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260622100000_normalize_product_unit.sql`:

```sql
-- Strip the redundant leading "per " from products.unit so values are stored as
-- bare nouns (e.g. "per set" -> "set"). The UI renders "per {unit}" for display.
-- Guarded + idempotent: rows already normalized do not match and are left alone.
update products
set unit = lower(trim(regexp_replace(unit, '^per\s+', '', 'i')))
where unit ~* '^per\s+';
```

- [ ] **Step 2: Apply the migration to the database**

Apply via the Supabase MCP `apply_migration` tool with name `normalize_product_unit` and the SQL above. (This records the migration in the remote project; the committed file keeps repo history in sync.)

- [ ] **Step 3: Verify the data is normalized**

Run via the Supabase MCP `execute_sql` tool:

```sql
select unit, count(*) as n from products group by unit order by n desc;
```

Expected: units are `set`, `unit`, `arch` (no value begins with `per `).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622100000_normalize_product_unit.sql
git commit -m "feat(products): migration to strip redundant 'per ' prefix from unit"
```

---

### Task 2: `normalizeUnit` helper + schema transform (TDD)

Make every future write normalize `unit` the same way the migration did, so typed custom values stay clean. The transform lives on the shared `productInputSchema`, which the Server Actions already validate against — so no action code changes.

**Files:**
- Modify: `src/domain/schemas.ts` (the `productInputSchema` `unit` field; add exported `normalizeUnit`)
- Test: `src/domain/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function normalizeUnit(raw: string): string` — trims, lowercases, strips a leading `per ` (with whitespace), trims again.
  - `productInputSchema` whose parsed `.data.unit` is normalized; empty/`"per "`-only input fails with message `"Unit is required"`.

- [ ] **Step 1: Write the failing tests**

Add to `src/domain/schemas.test.ts` — add `normalizeUnit` to the import on line 2, and append these tests inside the `describe('schemas', …)` block:

```ts
// at top of file, extend the existing import:
// import { paymentInputSchema, invoiceInputSchema, customerInputSchema, productInputSchema, normalizeUnit } from './schemas'

  it('normalizeUnit strips a leading "per " and lowercases', () => {
    expect(normalizeUnit('per unit')).toBe('unit')
    expect(normalizeUnit('Per Tooth')).toBe('tooth')
    expect(normalizeUnit('  per   arch ')).toBe('arch')
    expect(normalizeUnit('set')).toBe('set')
    expect(normalizeUnit('PER SET')).toBe('set')
  })
  it('normalizeUnit returns empty for blank or bare "per " input', () => {
    expect(normalizeUnit('   ')).toBe('')
    expect(normalizeUnit('per ')).toBe('')
  })
  it('productInputSchema normalizes the unit on parse', () => {
    const parsed = productInputSchema.safeParse(product({ unit: 'Per Tooth' }))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.unit).toBe('tooth')
  })
  it('productInputSchema rejects a unit that normalizes to empty', () => {
    expect(productInputSchema.safeParse(product({ unit: 'per ' })).success).toBe(false)
    expect(productInputSchema.safeParse(product({ unit: '' })).success).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/schemas.test.ts`
Expected: FAIL — `normalizeUnit` is not exported / not a function.

- [ ] **Step 3: Implement `normalizeUnit` and apply the transform**

In `src/domain/schemas.ts`, add the helper just after the `import { z } from 'zod'` line:

```ts
/**
 * Normalize a product unit-of-measure: trim, lowercase, and drop a redundant
 * leading "per " (the UI renders "per {unit}", so the stored value is the bare
 * noun, e.g. "tooth"). Returns "" for blank or bare-"per " input.
 */
export function normalizeUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/^per\s+/, '').trim()
}
```

Then change the `unit` field in `productInputSchema` (currently line 37) from:

```ts
    unit: z.string().min(1, 'Unit is required'),
```

to:

```ts
    unit: z
      .string()
      .transform(normalizeUnit)
      .refine((v) => v.length > 0, 'Unit is required'),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/schemas.test.ts`
Expected: PASS (all tests, including the pre-existing product tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/schemas.ts src/domain/schemas.test.ts
git commit -m "feat(products): normalize unit on write (strip 'per ', lowercase)"
```

---

### Task 3: `paginate()` pure helper (TDD)

The math behind pagination, isolated as a pure function so it can be unit-tested without React. The hook (Task 4) wraps it.

**Files:**
- Create: `src/lib/pagination.ts`
- Test: `src/lib/pagination.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface PageResult<T> {
    pageItems: T[]
    page: number       // clamped into [1, totalPages]
    totalPages: number // at least 1
    pageStart: number  // 1-based index of first item shown, 0 if empty
    pageEnd: number     // 1-based index of last item shown, 0 if empty
  }
  export function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T>
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pagination.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paginate } from './pagination'

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('paginate', () => {
  it('handles an empty list', () => {
    const r = paginate([], 1, 10)
    expect(r.pageItems).toEqual([])
    expect(r.totalPages).toBe(1)
    expect(r.page).toBe(1)
    expect(r.pageStart).toBe(0)
    expect(r.pageEnd).toBe(0)
  })
  it('returns the first page', () => {
    const r = paginate(range(13), 1, 10)
    expect(r.pageItems).toHaveLength(10)
    expect(r.totalPages).toBe(2)
    expect(r.pageStart).toBe(1)
    expect(r.pageEnd).toBe(10)
  })
  it('returns a partial last page', () => {
    const r = paginate(range(13), 2, 10)
    expect(r.pageItems).toEqual([11, 12, 13])
    expect(r.pageStart).toBe(11)
    expect(r.pageEnd).toBe(13)
  })
  it('clamps a page above the range', () => {
    const r = paginate(range(13), 5, 10)
    expect(r.page).toBe(2)
    expect(r.pageItems).toEqual([11, 12, 13])
  })
  it('clamps a page below 1', () => {
    const r = paginate(range(13), 0, 10)
    expect(r.page).toBe(1)
    expect(r.pageStart).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pagination.test.ts`
Expected: FAIL — cannot find module `./pagination` / `paginate` not defined.

- [ ] **Step 3: Implement `paginate`**

Create `src/lib/pagination.ts`:

```ts
export interface PageResult<T> {
  pageItems: T[]
  /** Page clamped into [1, totalPages]. */
  page: number
  /** Total number of pages, always at least 1. */
  totalPages: number
  /** 1-based index of the first item shown (0 when the list is empty). */
  pageStart: number
  /** 1-based index of the last item shown (0 when the list is empty). */
  pageEnd: number
}

/** Pure slice + clamp math for client-side pagination. */
export function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(Math.max(1, page), totalPages)
  const startIndex = (clamped - 1) * pageSize
  const pageItems = items.slice(startIndex, startIndex + pageSize)
  return {
    pageItems,
    page: clamped,
    totalPages,
    pageStart: total === 0 ? 0 : startIndex + 1,
    pageEnd: startIndex + pageItems.length,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pagination.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pagination.ts src/lib/pagination.test.ts
git commit -m "feat: add pure paginate() helper for client-side pagination"
```

---

### Task 4: `usePaginatedList` hook

React glue that composes search filtering + `paginate()` and owns the query/page state. No automated test (the repo has no React test env); verified by typecheck.

**Files:**
- Create: `src/lib/use-paginated-list.ts`

**Interfaces:**
- Consumes: `paginate` from `src/lib/pagination.ts`
- Produces:
  ```ts
  export interface UsePaginatedListResult<T> {
    query: string
    setQuery: (q: string) => void   // resets page to 1
    page: number                    // clamped
    setPage: (p: number) => void
    pageItems: T[]
    filteredCount: number
    totalPages: number
    pageStart: number
    pageEnd: number
  }
  export function usePaginatedList<T>(
    items: T[],
    opts: { searchFn: (item: T, query: string) => boolean; pageSize?: number },
  ): UsePaginatedListResult<T>
  ```
  Note: pass a **stable** `searchFn` (module-level or `useCallback`) to keep memoization stable.

- [ ] **Step 1: Implement the hook**

Create `src/lib/use-paginated-list.ts`:

```ts
'use client'

import { useMemo, useState } from 'react'
import { paginate } from '@/lib/pagination'

export interface UsePaginatedListOptions<T> {
  /** Return true if `item` matches the (already non-empty, trimmed) query. */
  searchFn: (item: T, query: string) => boolean
  pageSize?: number
}

export interface UsePaginatedListResult<T> {
  query: string
  setQuery: (q: string) => void
  page: number
  setPage: (p: number) => void
  pageItems: T[]
  filteredCount: number
  totalPages: number
  pageStart: number
  pageEnd: number
}

/**
 * Client-side search + pagination over an in-memory list. Filters with the
 * given predicate, then slices via `paginate`. Changing the query resets to
 * page 1; an out-of-range page is clamped for display.
 */
export function usePaginatedList<T>(
  items: T[],
  { searchFn, pageSize = 10 }: UsePaginatedListOptions<T>,
): UsePaginatedListResult<T> {
  const [query, setQueryState] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return items
    return items.filter((item) => searchFn(item, q))
  }, [items, query, searchFn])

  const { pageItems, page: clampedPage, totalPages, pageStart, pageEnd } = paginate(
    filtered,
    page,
    pageSize,
  )

  const setQuery = (q: string) => {
    setQueryState(q)
    setPage(1)
  }

  return {
    query,
    setQuery,
    page: clampedPage,
    setPage,
    pageItems,
    filteredCount: filtered.length,
    totalPages,
    pageStart,
    pageEnd,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/use-paginated-list.ts
git commit -m "feat: add usePaginatedList hook (search + pagination state)"
```

---

### Task 5: `Combobox` component

A reusable single-select combobox: a text input with a filtered suggestion dropdown that also accepts a custom typed value. Plain React (no Radix Popover) so it behaves reliably inside the existing Radix `Dialog` (no portal/focus-trap interplay); the dropdown is rendered inline and dismissed on outside click. `DialogContent` does not clip overflow, so the absolute dropdown is fine.

**Files:**
- Create: `src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `Check` from `lucide-react`
- Produces:
  ```ts
  export interface ComboboxProps {
    value: string
    onChange: (value: string) => void
    options: string[]
    placeholder?: string
    allowCustom?: boolean   // default true; when false the input is read-only (pick from list)
    id?: string
    className?: string
  }
  export function Combobox(props: ComboboxProps): JSX.Element
  ```

- [ ] **Step 1: Implement the component**

Create `src/components/ui/combobox.tsx`:

```tsx
'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** When true (default) the user may type a value not in `options`. */
  allowCustom?: boolean
  id?: string
  className?: string
}

/**
 * Single-select combobox: a text input with a filtered suggestion list.
 * Selecting a suggestion sets the value; with `allowCustom` the typed text is
 * itself a valid value. Plain React (no portal) so it nests safely in a Dialog.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  allowCustom = true,
  id,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const q = value.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        readOnly={!allowCustom}
        onChange={(e) => {
          if (allowCustom) onChange(e.target.value)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Enter' && open) {
            e.preventDefault()
            setOpen(false)
          }
        }}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-white p-1 text-sm shadow-md">
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                // onMouseDown (not onClick) so selection fires before the input
                // blurs and before the outside-click handler runs.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(opt)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground',
                  opt === value && 'bg-accent/60',
                )}
              >
                <span>{opt}</span>
                {opt === value && <Check className="h-4 w-4 text-green-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/combobox.tsx
git commit -m "feat(ui): add reusable Combobox (suggestions + custom value)"
```

---

### Task 6: `ListToolbar` + `Pagination` components

Two small presentational components. `ListToolbar` is a search input with an optional right-slot for future per-page filters; `Pagination` shows the result count + prev/next nav (nav hidden when a single page).

**Files:**
- Create: `src/components/ui/list-toolbar.tsx`
- Create: `src/components/ui/pagination.tsx`

**Interfaces:**
- Consumes: `Input` (`@/components/ui/input`), `Button` (`@/components/ui/button`), `cn` (`@/lib/utils`), `Search`/`ChevronLeft`/`ChevronRight` (`lucide-react`)
- Produces:
  ```ts
  export interface ListToolbarProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    children?: React.ReactNode   // right-slot for extra filters
  }
  export function ListToolbar(props: ListToolbarProps): JSX.Element

  export interface PaginationProps {
    page: number
    totalPages: number
    filteredCount: number
    pageStart: number
    pageEnd: number
    onPageChange: (page: number) => void
    itemLabel?: string   // e.g. "products"; default "results"
    className?: string
  }
  export function Pagination(props: PaginationProps): JSX.Element
  ```

- [ ] **Step 1: Implement `ListToolbar`**

Create `src/components/ui/list-toolbar.tsx`:

```tsx
'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ListToolbarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Optional right-slot for extra controls (status/work filters, etc.). */
  children?: React.ReactNode
}

/** Reusable list toolbar: a search box plus an optional right-aligned filter slot. */
export function ListToolbar({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  children,
}: ListToolbarProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Implement `Pagination`**

Create `src/components/ui/pagination.tsx`:

```tsx
'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PaginationProps {
  page: number
  totalPages: number
  filteredCount: number
  pageStart: number
  pageEnd: number
  onPageChange: (page: number) => void
  /** Plural noun for the count line, e.g. "products". */
  itemLabel?: string
  className?: string
}

/** Result count + prev/next nav. Nav hides when there is only one page. */
export function Pagination({
  page,
  totalPages,
  filteredCount,
  pageStart,
  pageEnd,
  onPageChange,
  itemLabel = 'results',
  className,
}: PaginationProps) {
  return (
    <div className={cn('flex items-center justify-between text-sm text-gray-500', className)}>
      <span>
        {filteredCount === 0
          ? `No ${itemLabel}`
          : `Showing ${pageStart}–${pageEnd} of ${filteredCount} ${itemLabel}`}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/list-toolbar.tsx src/components/ui/pagination.tsx
git commit -m "feat(ui): add reusable ListToolbar and Pagination components"
```

---

### Task 7: Add hover tooltips to the product row action buttons

Wrap the edit and toggle buttons in tooltips and add matching `aria-label`s, so users know what each icon does. Mount one `TooltipProvider` at the component root (mirrors `EmployeesManager`).

**Files:**
- Modify: `src/components/products/ProductsClient.tsx`

**Interfaces:**
- Consumes: `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` from `@/components/ui/tooltip`
- Produces: nothing for later tasks

- [ ] **Step 1: Import the tooltip components**

In `src/components/products/ProductsClient.tsx`, add after the table import (line 14):

```tsx
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
```

- [ ] **Step 2: Wrap the component root in `TooltipProvider`**

Change the opening of the returned JSX (currently lines 147-148):

```tsx
  return (
    <div className="space-y-6">
```

to:

```tsx
  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
```

And change the closing of that root `<div>` (currently lines 261-262):

```tsx
    </div>
  )
}
```

to:

```tsx
    </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 3: Wrap the action buttons in tooltips**

Replace the actions cell block (currently lines 185-196):

```tsx
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActive(p)}>
                          {p.active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                        </Button>
                      </div>
                    )}
                  </TableCell>
```

with:

```tsx
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit product" onClick={() => openEdit(p)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit product</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={p.active ? 'Deactivate product' : 'Activate product'}
                              onClick={() => toggleActive(p)}
                            >
                              {p.active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {p.active ? 'Active — click to deactivate (hides from new invoices)' : 'Inactive — click to activate'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/products/ProductsClient.tsx
git commit -m "feat(products): add hover tooltips + aria-labels to row actions"
```

---

### Task 8: Replace the unit text input with the Combobox + render "per {unit}"

Swap the bare `<Input>` for the `Combobox` (driven via react-hook-form `Controller`) with a fixed `per` prefix label and the dental-lab suggestion list, change the form defaults from `'per unit'` to `'unit'`, and render the table cell as `per {unit}`.

**Files:**
- Modify: `src/components/products/ProductsClient.tsx`

**Interfaces:**
- Consumes: `Combobox` from `@/components/ui/combobox`; `Controller` from `react-hook-form`
- Produces: nothing for later tasks

- [ ] **Step 1: Add imports and the options constant**

In `src/components/products/ProductsClient.tsx`:

Change the react-hook-form import (line 4) from:

```tsx
import { useForm, useWatch, type Resolver } from 'react-hook-form'
```

to:

```tsx
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
```

Add after the tooltip import added in Task 7:

```tsx
import { Combobox } from '@/components/ui/combobox'
```

Add a module-level constant just above the `optionalPrice` declaration (currently line 30):

```tsx
// Common dental-lab units (stored as bare nouns; rendered as "per {unit}").
// The combobox still accepts a custom typed value.
const UNIT_OPTIONS = ['unit', 'tooth', 'arch', 'quadrant', 'case', 'set', 'pair']
```

- [ ] **Step 2: Change the form defaults from `'per unit'` to `'unit'`**

In `useForm`'s `defaultValues` (line 78), change `unit: 'per unit'` to `unit: 'unit'`.

In `openNew`'s `reset({...})` (line 91), change `unit: 'per unit',` to `unit: 'unit',`.

(`openEdit` already uses `unit: p.unit`, which is the migrated bare noun — leave it.)

- [ ] **Step 3: Render `per {unit}` in the table cell**

Change the unit `<TableCell>` (currently line 176) from:

```tsx
                  <TableCell className="text-gray-500 text-sm">{p.unit}</TableCell>
```

to:

```tsx
                  <TableCell className="text-gray-500 text-sm">per {p.unit}</TableCell>
```

- [ ] **Step 4: Replace the unit form field with the Combobox**

Change the unit field block in the form (currently lines 250-253):

```tsx
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Input placeholder="per unit" {...register('unit')} />
            </div>
```

with:

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
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={UNIT_OPTIONS}
                        placeholder="unit"
                      />
                    )}
                  />
                </div>
              </div>
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If `Input` is now unused anywhere in the file, the lint step will flag it — it is still used by the name/price fields, so it should remain imported.)

- [ ] **Step 6: Commit**

```bash
git add src/components/products/ProductsClient.tsx
git commit -m "feat(products): unit combobox with 'per' prefix; render 'per {unit}'"
```

---

### Task 9: Wire search + pagination into the products list

Drive the table from `usePaginatedList` instead of the raw `products` prop: add the `<ListToolbar>` above the table and `<Pagination>` below it, map over `pageItems`, and update the empty-state copy.

**Files:**
- Modify: `src/components/products/ProductsClient.tsx`

**Interfaces:**
- Consumes: `usePaginatedList` (`@/lib/use-paginated-list`), `ListToolbar` (`@/components/ui/list-toolbar`), `Pagination` (`@/components/ui/pagination`)
- Produces: nothing

- [ ] **Step 1: Add imports and a stable search predicate**

In `src/components/products/ProductsClient.tsx`, add these imports after the `Combobox` import:

```tsx
import { usePaginatedList } from '@/lib/use-paginated-list'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { Pagination } from '@/components/ui/pagination'
```

Add a module-level predicate just below the `UNIT_OPTIONS` constant:

```tsx
// Stable identity (module-level) so the hook's memoized filter is stable.
function productMatchesQuery(p: Product, query: string): boolean {
  const q = query.toLowerCase()
  return (
    p.name.toLowerCase().includes(q) ||
    (p.description?.toLowerCase().includes(q) ?? false) ||
    p.unit.toLowerCase().includes(q)
  )
}
```

- [ ] **Step 2: Call the hook inside the component**

Add just after `const usePriceRange = useWatch(...)` (line 80):

```tsx
  const {
    query,
    setQuery,
    page,
    setPage,
    pageItems,
    filteredCount,
    totalPages,
    pageStart,
    pageEnd,
  } = usePaginatedList(products, { searchFn: productMatchesQuery, pageSize: 10 })
```

- [ ] **Step 3: Add the toolbar above the Card and paginate the table body**

Insert the toolbar between the header `</div>` (currently line 155) and `<Card>` (line 157):

```tsx
      <ListToolbar value={query} onChange={setQuery} placeholder="Search products…" />
```

Change the empty-state row and the map (currently lines 171-172):

```tsx
              {products.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">No products yet</TableCell></TableRow>}
              {products.map(p => (
```

to:

```tsx
              {pageItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-400">
                    {query ? 'No products match your search' : 'No products yet'}
                  </TableCell>
                </TableRow>
              )}
              {pageItems.map(p => (
```

- [ ] **Step 4: Add the pagination bar inside the Card, after the Table**

Change the end of the Card (currently lines 200-202):

```tsx
          </Table>
        </CardContent>
      </Card>
```

to:

```tsx
          </Table>
        </CardContent>
        <div className="border-t px-4 py-3">
          <Pagination
            page={page}
            totalPages={totalPages}
            filteredCount={filteredCount}
            pageStart={pageStart}
            pageEnd={pageEnd}
            onPageChange={setPage}
            itemLabel="products"
          />
        </div>
      </Card>
```

- [ ] **Step 5: Typecheck, lint, and run the full test suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type/lint errors; all vitest tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/products/ProductsClient.tsx
git commit -m "feat(products): add reusable search + pagination to the list"
```

---

### Task 10: Build + manual verification

End-to-end check of the whole feature in the running app.

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 2: Manual verification (dev server)**

Run `npm run dev`, sign in as a user with `products.edit`, go to `/products`, and confirm:
- The **Unit** column reads `per set`, `per unit`, `per arch` (the "per" appears once, from display).
- **Hovering** the pencil shows "Edit product"; hovering the toggle shows "Active — click to deactivate (hides from new invoices)" (or the inactive variant).
- **Add Product** → the Unit field shows a `per` prefix and a combobox; picking a suggestion (e.g. `tooth`) and typing a custom value both work; saving stores the bare noun and the row shows `per tooth`.
- Typing a value like `Per Tooth` then saving stores `tooth` (normalized) and displays `per tooth`.
- **Search** filters by name/description/unit and resets to page 1; the count line updates.
- With >10 products, **pagination** shows "Showing 1–10 of N products" and Prev/Next page correctly (edges disabled); with ≤10 the nav is hidden.

- [ ] **Step 3: Final confirmation**

No commit needed (no code change). If the manual check reveals a defect, fix it under the relevant task and re-run Steps 1-2.

---

## Self-Review

**Spec coverage:**
- Part 1 (unit storage): migration (Task 1), normalization transform (Task 2), combobox input + `per` prefix + `per {unit}` display + default change (Task 8). ✓
- Part 2 (tooltips/clarity): Task 7 (tooltips + aria-labels, dynamic toggle text). ✓
- Part 3 (reusable search + pagination, Approach A): `paginate` (Task 3), `usePaginatedList` (Task 4), `ListToolbar` + `Pagination` (Task 6), products wiring with name/description/unit search + pageSize 10 (Task 9). ✓
- Files listed in the spec: all covered; `product-actions.ts` intentionally NOT modified (it already validates via `productInputSchema`, so the transform applies automatically — noted in Architecture).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output.

**Type consistency:** `paginate` returns `{ pageItems, page, totalPages, pageStart, pageEnd }`; `usePaginatedList` destructures exactly those and re-exports `page` (clamped), adding `query/setQuery/setPage/filteredCount`. `Pagination` props (`page, totalPages, filteredCount, pageStart, pageEnd, onPageChange, itemLabel`) match the values passed in Task 9. `Combobox` props (`value, onChange, options, placeholder`) match the `Controller` render in Task 8. `normalizeUnit` is defined and exported in Task 2 and imported by its test. Names are consistent across tasks.
