# Phase 0a — Shared DataTable + List States (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable list-UI foundation — a shared `DataTable`, `Skeleton`/`EmptyState`/`ErrorState` primitives, and pure status/state helpers — and prove it by adopting it in the Products list with real loading/error routes.

**Architecture:** Pure, unit-tested helpers in `src/lib` (`statusBadgeVariant`, `listViewState`, `alignClass`) back thin presentational components in `src/components/ui`. `DataTable` composes the existing `Table` primitives (no new dependency). Visual components are verified by running the app on port 6060; all branching logic lives in tested pure functions to match this codebase's existing pure-logic vitest style (no React Testing Library in the repo).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict:false), Tailwind v4, Supabase, shadcn-style primitives, vitest.

## Global Constraints

- Branch: `feat/redesign-program` (already checked out). Do NOT touch `main`.
- TypeScript `strict: false`: narrow `ActionResult` unions with `result.ok === false`, never `!result.ok`.
- Dev server runs on **port 6060** (`npm run dev`), never 3000.
- Currency is MYR via `formatCurrency` from `@/lib/utils`; money columns are right-aligned and use the `tabular-nums` class.
- **No new npm dependencies** in this plan (`DataTable` composes the existing `Table`; cmdk/TanStack are later plans).
- Reuse existing primitives in `src/components/ui`; follow existing file style (named exports, `cn` from `@/lib/utils`).
- Run quality gates with: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- This is **Plan 0a of Phase 0**. Out of scope here (separate plans): design-token sweep (0b), rolling DataTable across Invoices/Customers/Work (0c), settings→Server Components (0d), Cmd+K palette (0e).

---

### Task 1: `statusBadgeVariant` helper

One canonical mapping from a domain status to a `Badge` variant, replacing the ad-hoc `STATUS_VARIANT` map currently inlined in `ActionsBar.tsx`.

**Files:**
- Create: `src/lib/status-badge.ts`
- Test: `src/lib/status-badge.test.ts`

**Interfaces:**
- Produces: `statusBadgeVariant(kind: 'payment' | 'work', value: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/status-badge.test.ts
import { describe, it, expect } from 'vitest'
import { statusBadgeVariant } from './status-badge'

describe('statusBadgeVariant', () => {
  it('maps payment statuses', () => {
    expect(statusBadgeVariant('payment', 'draft')).toBe('secondary')
    expect(statusBadgeVariant('payment', 'sent')).toBe('info')
    expect(statusBadgeVariant('payment', 'partial')).toBe('warning')
    expect(statusBadgeVariant('payment', 'paid')).toBe('success')
    expect(statusBadgeVariant('payment', 'overdue')).toBe('destructive')
  })

  it('maps work statuses', () => {
    expect(statusBadgeVariant('work', 'received')).toBe('secondary')
    expect(statusBadgeVariant('work', 'in_progress')).toBe('info')
    expect(statusBadgeVariant('work', 'ready')).toBe('success')
    expect(statusBadgeVariant('work', 'delivered')).toBe('secondary')
    expect(statusBadgeVariant('work', 'on_hold')).toBe('warning')
  })

  it('falls back to secondary for unknown values', () => {
    expect(statusBadgeVariant('payment', 'mystery')).toBe('secondary')
    expect(statusBadgeVariant('work', '')).toBe('secondary')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/status-badge.test.ts`
Expected: FAIL — cannot find module `./status-badge`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/status-badge.ts
import type { BadgeProps } from '@/components/ui/badge'

export type StatusKind = 'payment' | 'work'
export type BadgeVariant = NonNullable<BadgeProps['variant']>

const PAYMENT: Record<string, BadgeVariant> = {
  draft: 'secondary',
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  overdue: 'destructive',
  void: 'destructive',
}

const WORK: Record<string, BadgeVariant> = {
  received: 'secondary',
  in_progress: 'info',
  ready: 'success',
  delivered: 'secondary',
  on_hold: 'warning',
}

/** Canonical domain-status → Badge variant. Unknown values fall back to 'secondary'. */
export function statusBadgeVariant(kind: StatusKind, value: string): BadgeVariant {
  const table = kind === 'payment' ? PAYMENT : WORK
  return table[value] ?? 'secondary'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/status-badge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/status-badge.ts src/lib/status-badge.test.ts
git commit -m "feat(ui): canonical statusBadgeVariant helper"
```

---

### Task 2: `listViewState` helper

Decides which state a list is in, so every list renders empty/loading/no-results consistently.

**Files:**
- Create: `src/lib/list-view-state.ts`
- Test: `src/lib/list-view-state.test.ts`

**Interfaces:**
- Produces: `listViewState(args: { loading: boolean; total: number; filtered: number; hasQuery: boolean }): 'loading' | 'empty-first-run' | 'empty-no-results' | 'rows'`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/list-view-state.test.ts
import { describe, it, expect } from 'vitest'
import { listViewState } from './list-view-state'

describe('listViewState', () => {
  it('is loading when loading is true regardless of counts', () => {
    expect(listViewState({ loading: true, total: 5, filtered: 5, hasQuery: false })).toBe('loading')
  })
  it('is empty-first-run when there is no underlying data', () => {
    expect(listViewState({ loading: false, total: 0, filtered: 0, hasQuery: false })).toBe('empty-first-run')
  })
  it('is empty-no-results when a query filters everything out', () => {
    expect(listViewState({ loading: false, total: 5, filtered: 0, hasQuery: true })).toBe('empty-no-results')
  })
  it('is rows when there are visible items', () => {
    expect(listViewState({ loading: false, total: 5, filtered: 3, hasQuery: true })).toBe('rows')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/list-view-state.test.ts`
Expected: FAIL — cannot find module `./list-view-state`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/list-view-state.ts
export type ListViewState = 'loading' | 'empty-first-run' | 'empty-no-results' | 'rows'

export function listViewState(args: {
  loading: boolean
  total: number
  filtered: number
  hasQuery: boolean
}): ListViewState {
  if (args.loading) return 'loading'
  if (args.total === 0) return 'empty-first-run'
  if (args.filtered === 0 && args.hasQuery) return 'empty-no-results'
  return 'rows'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/list-view-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/list-view-state.ts src/lib/list-view-state.test.ts
git commit -m "feat(ui): listViewState decision helper"
```

---

### Task 3: DataTable column model + `alignClass`

Pure, framework-free model the `DataTable` component will consume. Kept in `src/lib` so it's testable without importing React.

**Files:**
- Create: `src/lib/data-table.ts`
- Test: `src/lib/data-table.test.ts`

**Interfaces:**
- Produces:
  - `type Align = 'left' | 'right' | 'center'`
  - `interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: Align; className?: string; headClassName?: string; width?: string }`
  - `alignClass(align?: Align): 'text-left' | 'text-right' | 'text-center'`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data-table.test.ts
import { describe, it, expect } from 'vitest'
import { alignClass } from './data-table'

describe('alignClass', () => {
  it('defaults to left', () => {
    expect(alignClass()).toBe('text-left')
    expect(alignClass('left')).toBe('text-left')
  })
  it('maps right and center', () => {
    expect(alignClass('right')).toBe('text-right')
    expect(alignClass('center')).toBe('text-center')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/data-table.test.ts`
Expected: FAIL — cannot find module `./data-table`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/data-table.ts
import type { ReactNode } from 'react'

export type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  /** Stable key for React + column identity. */
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: Align
  /** Extra classes for the body cell. */
  className?: string
  /** Extra classes for the header cell. */
  headClassName?: string
  /** Tailwind width class for the column, e.g. 'w-24'. */
  width?: string
}

export function alignClass(align: Align = 'left'): 'text-left' | 'text-right' | 'text-center' {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/data-table.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data-table.ts src/lib/data-table.test.ts
git commit -m "feat(ui): DataTable column model + alignClass"
```

---

### Task 4: Skeleton, EmptyState, ErrorState primitives

Three small presentational primitives. No unit tests (pure markup); verified by typecheck/lint and later visual use.

**Files:**
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/error-state.tsx`

**Interfaces:**
- Produces:
  - `Skeleton(props: React.HTMLAttributes<HTMLDivElement>)`
  - `EmptyState({ icon?, title, description?, action? , className? })`
  - `ErrorState({ title?, description?, onRetry })`

- [ ] **Step 1: Create the Skeleton primitive**

```tsx
// src/components/ui/skeleton.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
```

- [ ] **Step 2: Create the EmptyState primitive**

```tsx
// src/components/ui/empty-state.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Create the ErrorState primitive**

```tsx
// src/components/ui/error-state.tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry: () => void
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <AlertTriangle className="mb-3 h-6 w-6 text-destructive" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Verify typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, all tests pass (existing 125 + 9 new from Tasks 1-3 = 134).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/skeleton.tsx src/components/ui/empty-state.tsx src/components/ui/error-state.tsx
git commit -m "feat(ui): Skeleton, EmptyState, ErrorState primitives"
```

---

### Task 5: DataTable component

The shared list table: sticky header, alignable columns, skeleton rows while loading, an empty slot, a footer slot (for pagination), optional density and per-row classes.

**Files:**
- Create: `src/components/ui/data-table.tsx`

**Interfaces:**
- Consumes: `Column<T>`, `Align`, `alignClass` from `@/lib/data-table`; `Table*` from `@/components/ui/table`; `Skeleton` from `@/components/ui/skeleton`.
- Produces: `DataTable<T>(props: DataTableProps<T>)` where
  `DataTableProps<T> = { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; loading?: boolean; skeletonRows?: number; empty?: ReactNode; footer?: ReactNode; rowClassName?: (row: T) => string; stickyHeader?: boolean; dense?: boolean }`

- [ ] **Step 1: Create the DataTable component**

```tsx
// src/components/ui/data-table.tsx
import * as React from 'react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { alignClass, type Column } from '@/lib/data-table'
import { cn } from '@/lib/utils'

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  skeletonRows?: number
  /** Shown (spanning all columns) when not loading and there are no rows. */
  empty?: React.ReactNode
  /** Rendered under the table, e.g. pagination. */
  footer?: React.ReactNode
  rowClassName?: (row: T) => string
  stickyHeader?: boolean
  dense?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 6,
  empty,
  footer,
  rowClassName,
  stickyHeader = true,
  dense = false,
}: DataTableProps<T>) {
  const cellPad = dense ? 'py-2' : 'py-3'
  const showEmpty = !loading && rows.length === 0

  return (
    <div className="w-full overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map(c => (
              <TableHead
                key={c.key}
                className={cn(stickyHeader && 'sticky top-0 z-10 bg-card', alignClass(c.align), c.width, c.headClassName)}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                {columns.map(c => (
                  <TableCell key={c.key} className={cellPad}>
                    <Skeleton className="h-4 w-full max-w-[12rem]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}

          {showEmpty && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          )}

          {!loading &&
            rows.map(row => (
              <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map(c => (
                  <TableCell key={c.key} className={cn(cellPad, alignClass(c.align), c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {footer && <div className="border-t px-4 py-3">{footer}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/data-table.tsx
git commit -m "feat(ui): shared DataTable primitive"
```

---

### Task 6: Products route loading + error states

Add `loading.tsx` (a skeleton that matches the Products layout) and `error.tsx` (a retry card) for the Products segment.

**Files:**
- Create: `src/app/(authenticated)/products/loading.tsx`
- Create: `src/app/(authenticated)/products/error.tsx`

**Interfaces:**
- Consumes: `Skeleton` from `@/components/ui/skeleton`; `ErrorState` from `@/components/ui/error-state`.

- [ ] **Step 1: Create the loading skeleton**

```tsx
// src/app/(authenticated)/products/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function ProductsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create the error boundary**

```tsx
// src/app/(authenticated)/products/error.tsx
'use client'

import { ErrorState } from '@/components/ui/error-state'

export default function ProductsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load products"
      description="There was a problem loading the product catalog. Please try again."
      onRetry={reset}
    />
  )
}
```

- [ ] **Step 3: Verify typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authenticated)/products/loading.tsx" "src/app/(authenticated)/products/error.tsx"
git commit -m "feat(products): route loading skeleton + error retry"
```

---

### Task 7: Adopt DataTable + helpers in the Products list

Replace the hand-rolled `Table` block in `ProductsClient.tsx` with the shared `DataTable`, driving the empty state through `listViewState` + `EmptyState`. The create/edit dialog and all actions stay unchanged.

**Files:**
- Modify: `src/components/products/ProductsClient.tsx` (imports near lines 11-21; the render block lines 190-270)

**Interfaces:**
- Consumes: `DataTable` from `@/components/ui/data-table`; `Column` from `@/lib/data-table`; `EmptyState` from `@/components/ui/empty-state`; `listViewState` from `@/lib/list-view-state`.

- [ ] **Step 1: Update imports**

In `src/components/products/ProductsClient.tsx`, replace the table-primitive import line:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
```

with:

```tsx
import { DataTable } from '@/components/ui/data-table'
import type { Column } from '@/lib/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { listViewState } from '@/lib/list-view-state'
import { Package } from 'lucide-react'
```

(Keep the existing `Badge`, `Card`, `Pagination`, `Tooltip*`, `Button`, `formatCurrency` imports.)

- [ ] **Step 2: Define the columns above the return**

Inside `ProductsClient`, immediately before `return (`, add:

```tsx
  const columns: Column<Product>[] = [
    { key: 'name', header: 'Name', cell: p => <span className="font-medium">{p.name}</span> },
    { key: 'description', header: 'Description', cell: p => <span className="text-sm text-muted-foreground">{p.description ?? '—'}</span> },
    { key: 'unit', header: 'Unit', cell: p => <span className="text-sm text-muted-foreground">per {p.unit}</span> },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      cell: p => (
        <span className="font-medium tabular-nums">
          {p.min_unit_price != null && p.max_unit_price != null
            ? `${formatCurrency(p.min_unit_price)} – ${formatCurrency(p.max_unit_price)}`
            : formatCurrency(p.unit_price)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: p => <Badge variant={p.active ? 'success' : 'secondary'}>{p.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 'w-24',
      cell: p =>
        canEdit ? (
          <div className="flex justify-end gap-1">
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
        ) : null,
    },
  ]

  const view = listViewState({
    loading: false,
    total: products.length,
    filtered: filteredCount,
    hasQuery: query.trim().length > 0,
  })

  const emptyState = (
    <EmptyState
      icon={<Package className="h-8 w-8" />}
      title={view === 'empty-no-results' ? 'No products match your search' : 'No products yet'}
      description={view === 'empty-no-results' ? 'Try a different search term.' : 'Add your first product to start invoicing.'}
    />
  )
```

- [ ] **Step 3: Replace the Card/Table/Pagination block**

Replace the JSX from `<Card>` through its closing `</Card>` (the block currently at lines ~190-270, containing `<Table>…</Table>` and the `<Pagination …/>`) with:

```tsx
      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={pageItems}
            rowKey={p => p.id}
            rowClassName={p => (p.active ? '' : 'opacity-50')}
            empty={emptyState}
            footer={
              <Pagination
                page={page}
                totalPages={totalPages}
                filteredCount={filteredCount}
                pageStart={pageStart}
                pageEnd={pageEnd}
                onPageChange={setPage}
                itemLabel="products"
              />
            }
          />
        </CardContent>
      </Card>
```

- [ ] **Step 4: Verify typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exits 0, lint clean, all tests pass. (If tsc flags an unused `Table`/`TableRow` import, remove it.)

- [ ] **Step 5: Verify visually in the running app**

Run the dev server: `npm run dev` (port 6060). Visit `http://localhost:6060/products`. Confirm:
- The product rows render through the new table with right-aligned, tabular-nums prices and a sticky header on scroll.
- Searching for a non-existent term shows the "No products match your search" empty state.
- Edit / activate-toggle actions still work and the create/edit dialog is unchanged.

(Use the browser-harness skill or a manual check; capture a screenshot for the review.)

- [ ] **Step 6: Commit**

```bash
git add src/components/products/ProductsClient.tsx
git commit -m "feat(products): adopt shared DataTable + EmptyState"
```

---

## Self-Review

- **Spec coverage (Phase 0a slice):** DataTable primitive ✓ (Task 5), skeleton/empty/error states ✓ (Tasks 4, 6), right-aligned tabular-nums money + status-badge helper ✓ (Tasks 1, 7), one module piloted end-to-end ✓ (Tasks 6-7). Tokens sweep, other modules, settings→RSC, and Cmd+K are deliberately deferred to plans 0b-0e (noted in Global Constraints).
- **Placeholder scan:** none — every step has complete code or an exact command.
- **Type consistency:** `Column<T>`/`Align`/`alignClass` defined in Task 3 are consumed unchanged in Tasks 5 and 7; `DataTableProps` field names (`rows`, `rowKey`, `empty`, `footer`, `rowClassName`) match between Task 5's definition and Task 7's usage; `statusBadgeVariant` (Task 1) and `listViewState` (Task 2) signatures match their consumers.

## Follow-on plans (rest of Phase 0)
- **0b** — Design-token sweep: semantic status/neutral tokens in `globals.css`, replace raw `text-gray-*`/`bg-white` with tokens, grep CI guard.
- **0c** — Roll `DataTable` + route states across Invoices, Customers, Work lists (+ adopt `statusBadgeVariant`, retire the inline `STATUS_VARIANT` in `ActionsBar.tsx`).
- **0d** — Convert the 5 client-fetch Settings pages to async Server Components with client-island dialogs.
- **0e** — Cmd+K command palette (adds `cmdk`).
