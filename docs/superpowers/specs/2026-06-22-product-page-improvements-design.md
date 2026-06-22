# Product page improvements — design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Scope:** Products list page UX + a reusable search/pagination foundation

## Problem

The products page ([`src/components/products/ProductsClient.tsx`](../../../src/components/products/ProductsClient.tsx)) has three rough edges:

1. **Unit is unconstrained free text.** Stored as `z.string().min(1)`; the form is a bare
   `<Input placeholder="per unit">`. Values drift ("per unit" / "unit" / "each"…) and every
   real value redundantly repeats the word **"per"**. Current data confirms this: all 13 rows are
   `per set` (6), `per unit` (6), `per arch` (1).
2. **Icon-only action buttons with no labels, tooltips, or `aria-label`.** Users can't tell what
   the pencil and the toggle do without clicking.
3. **No search or pagination**, and no reusable pattern — every list page reimplements its own
   inline search via `useMemo`, none paginate.

## Goals

- Make `unit` consistent and drop the redundant "per".
- Make the row actions self-explanatory on hover.
- Add search + pagination to the products page **as reusable pieces** other list pages can adopt
  later with no API changes.

## Non-goals

- No changes to invoices/receipts (the `unit` field is not displayed there — products table is its
  only consumer).
- No migration of other list pages (customers, invoices, employees, roles) in this work; we only
  build the reusable pieces and wire them into products.
- No new npm dependencies.

---

## Part 1 — Unit: store the bare noun, render "per X"

### Storage
Store the bare, lowercased noun (`set`, `unit`, `arch`, …) instead of `per set`. One-time data
migration over the existing rows:

```sql
update products
set unit = lower(trim(regexp_replace(unit, '^per\s+', '', 'i')))
where unit ~* '^per\s+';
```

This converts the 13 existing rows to `set` / `unit` / `arch`. Idempotent (the `where` guard means
re-running is a no-op).

### Input — Combobox
Replace the plain text input with a lightweight **Combobox** built on the already-installed
`@radix-ui/react-popover` (no `cmdk`, no new dependency). Behavior:

- A fixed **`per`** prefix label sits before the control, so the stored noun still reads as a unit:
  `Unit *  per [ tooth ▼ ]`.
- A suggestion list of common dental-lab units: `unit, tooth, arch, quadrant, case, set, pair`.
- The user may pick a suggestion **or type a custom value** (the field is not locked to the list).

New file: `src/components/ui/combobox.tsx` — a generic, reusable single-select combobox
(`value`, `onChange`, `options`, `placeholder`, `allowCustom`) so it can be reused beyond this form.

### Normalization
Normalize on submit so even custom entries stay clean. In [`src/domain/schemas.ts`](../../../src/domain/schemas.ts),
apply a Zod transform to `unit`: `trim → toLowerCase → strip a leading "per " → ensure non-empty`.
The same `productSchema` is used client- and server-side, so this enforces consistency in both.

### Display
- Products table cell renders **`per {unit}`** (so "per tooth"), keeping the column readable even
  though "per" is not stored. ([`ProductsClient.tsx`](../../../src/components/products/ProductsClient.tsx), the unit `<TableCell>`).
- The new-product form default becomes `unit` (was `per unit`).

---

## Part 2 — Button clarity + hover hints

Wrap both row action buttons in the existing `Tooltip` ([`src/components/ui/tooltip.tsx`](../../../src/components/ui/tooltip.tsx))
and add matching `aria-label`s:

| Button | Icon | Tooltip / `aria-label` |
| --- | --- | --- |
| Edit | `Pencil` | **"Edit product"** |
| Toggle (active) | green `ToggleRight` | **"Active — click to deactivate (hides from new invoices)"** |
| Toggle (inactive) | gray `ToggleLeft` | **"Inactive — click to activate"** |

The tooltip text makes explicit that the toggle is a soft enable/disable (archive), not a delete.
A single `TooltipProvider` wraps the table (or the existing app provider, if present) to avoid
per-row provider overhead.

---

## Part 3 — Reusable search + pagination (client-side, Approach A)

Chosen over a fully generic `<DataTable columns>` (too invasive for the existing bespoke tables)
and over server-side URL pagination (overkill for a 13-row table). Matches the codebase's existing
"load all rows + filter client-side" pattern, adds no dependencies, and reuses across all current
list pages. The produced UI can later be fed by a server-side data source for the one unbounded
table (invoices) without changing the controls.

### `usePaginatedList<T>` — hook
New file: `src/lib/use-paginated-list.ts`

```ts
function usePaginatedList<T>(
  items: T[],
  opts: { searchFn: (item: T, query: string) => boolean; pageSize?: number }
): {
  query: string
  setQuery: (q: string) => void
  page: number
  setPage: (p: number) => void
  pageItems: T[]        // the current page slice of the filtered list
  filteredCount: number // total matches after search
  totalPages: number
  pageStart: number     // 1-based index of first item shown (0 if empty)
  pageEnd: number       // 1-based index of last item shown
}
```

- Filters with `useMemo` on `items` + `query`.
- Resets to page 1 when the query changes; clamps `page` into range when the filtered list shrinks.
- `pageSize` defaults to 10.

### `<ListToolbar>` — search bar
New file: `src/components/ui/list-toolbar.tsx`

- Props: `value`, `onChange`, `placeholder?`, and `children?` (an optional right-slot so pages like
  customers/invoices can drop their status/work filters into the same bar later).
- Renders a search `Input` with a lucide `Search` icon.

### `<Pagination>` — pager
New file: `src/components/ui/pagination.tsx`

- Props: `page`, `totalPages`, `onPageChange`, `filteredCount`, `pageStart`, `pageEnd`.
- Renders **"Showing {pageStart}–{pageEnd} of {filteredCount}"** plus **‹ Prev · Page p of T · Next ›**
  with disabled edges. The nav buttons are hidden when `totalPages <= 1`; the count line still shows.

### Products wiring
In [`ProductsClient.tsx`](../../../src/components/products/ProductsClient.tsx):

- `searchFn`: case-insensitive match of `query` against `name`, `description`, and `unit`.
- `pageSize`: 10.
- Render `<ListToolbar>` above the table and `<Pagination>` below it, driven by the hook;
  the `<TableBody>` maps over `pageItems` instead of the full list.

---

## Files

| File | Change |
| --- | --- |
| SQL migration (new) | Strip leading "per " from `products.unit` |
| `src/components/ui/combobox.tsx` | New — reusable single-select combobox (Popover-based) |
| `src/lib/use-paginated-list.ts` | New — search + pagination hook |
| `src/components/ui/list-toolbar.tsx` | New — search bar with optional filter slot |
| `src/components/ui/pagination.tsx` | New — pager + result count |
| `src/domain/schemas.ts` | `unit` Zod transform (trim/lowercase/strip "per ") |
| `src/components/products/ProductsClient.tsx` | Combobox unit input, `per {unit}` display, button tooltips, search + pagination wiring |

## Risks / notes

- **No dependency added** — combobox uses installed Popover; tooltip component already exists.
- **Migration is idempotent** and scoped by the `^per\s+` guard.
- The reusable trio (`usePaginatedList`, `ListToolbar`, `Pagination`) is intentionally
  presentation-agnostic so existing bespoke tables keep their custom cells when they adopt it.
- The combobox is generic; if `allowCustom` proves unnecessary later it can be tightened to a strict
  select without touching consumers' props shape.

## Verification

- Migration: re-query `select unit, count(*) from products group by unit` — expect `set`, `unit`,
  `arch` with no "per " prefixes.
- Unit input: create/edit a product picking a suggestion and typing a custom value; confirm stored
  value is normalized and the table shows `per {unit}`.
- Tooltips: hover both buttons in active and inactive states; confirm correct text and `aria-label`.
- Search + pagination: type in the toolbar (list filters + count updates, resets to page 1); page
  through results; confirm edges disable and the "Showing X–Y of N" line is correct.
