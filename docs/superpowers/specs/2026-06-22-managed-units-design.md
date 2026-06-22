# Managed Units — design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Scope:** Turn the product `unit` into an admin-managed catalog and replace the free-typing field with a clean dropdown.

## Problem

The product `unit` is entered through a free-typing combobox over a **hardcoded** list
(`UNIT_OPTIONS` in [`ProductsClient.tsx`](../../../src/components/products/ProductsClient.tsx)).
Two problems:

1. **No real "add a unit" workflow.** A new unit is just free text typed into the field, so
   typos and near-duplicates ("set" / "sets" / "Set") can creep in, and there's no curated catalog.
2. **The field UI is disliked.** The combobox (text input + filtered dropdown + custom typing)
   feels unpolished for what is really a pick-from-a-short-list choice.

## Goals

- Give units a curated, admin-managed catalog with a clear add/rename/reorder/retire workflow.
- Make the product field a clean dropdown of those units (no free typing).
- Match the app's existing managed-list conventions (Work Stages, Service Statuses) so it slots in
  with no new patterns.

## Non-goals

- No foreign-key migration on `products` (see Data model — units stay a validated string).
- No color/styling for units (unlike work stages/service statuses, units render as plain "per X").
- No search/pagination on the units manager (the list is tiny).

---

## Decisions (resolved)

- **`products.unit` stays a `text` string** holding the chosen label, validated against the active
  units in the form — not a `unit_id` foreign key. Avoids a products migration and matches the
  current model. **Tradeoff:** renaming a unit in Settings does not rewrite the label already stored
  on existing products; they keep their stored string. Acceptable for a lab where units rarely change.
- **Remove the now-unused `Combobox` component and `UNIT_OPTIONS`.** After the field switches to
  `<Select>`, `src/components/ui/combobox.tsx` has no consumers (verified: the only other mention is
  a code comment in `ProductSearchAdd.tsx`). Delete it to avoid dead code; it's recoverable from git.

---

## Part 1 — `units` table (managed list)

A new table mirroring `work_stages` / `service_statuses`, **without `color`**:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `label` | text not null | the bare noun, e.g. `tooth` |
| `sort_order` | int not null | dropdown / list ordering |
| `is_active` | boolean not null default true | retire without deleting |
| `created_at` | timestamptz not null default now() | |

**RLS:** mirror the `work_stages` policies exactly — read for authenticated users; insert/update
gated to the `settings.manage` permission (same policy shape Spec 5 uses for the other settings
tables). No DELETE (manager deactivates rather than hard-deletes, matching work stages).

**Seed:** insert the current seven values so existing products stay valid and the dropdown has
sensible defaults (these already cover every existing product unit — `unit`, `set`, `arch`):

```
unit, tooth, arch, quadrant, case, set, pair   (sort_order 10,20,…,70; is_active true)
```

After the migration, regenerate `src/lib/database-generated.types.ts` and add
`export type Unit = Tables<'units'>` to `src/lib/database.types.ts`.

## Part 2 — Settings → Units manager page

New route `/settings/units`, a near-copy of
[`settings/work-stages/page.tsx`](../../../src/app/(authenticated)/settings/work-stages/page.tsx)
with the color UI removed:

- Client component; loads `units` via the Supabase client ordered by `sort_order`.
- Table columns: **Order** (↑/↓ reorder via `sort_order` swap), **Label**, **Status**
  (Active/Inactive), **Actions** (edit, activate/deactivate toggle — with the row-action tooltips
  pattern from the products page).
- **Add / edit** via a dialog with a single `label` input; new rows get
  `sort_order = (last?.sort_order ?? 0) + 10`.
- **Deactivate** toggles `is_active` (no hard delete).
- Gated by `settings.manage` (page-level, same as the other settings managers).

**Navigation:** add one entry to [`navigation.ts`](../../../src/domain/navigation.ts) under the
"Lab Setup" group, so the two-pane settings rail and deep-link guard pick it up automatically:

```ts
{ href: '/settings/units', label: 'Units', icon: Ruler, area: 'settings', group: 'Lab Setup', permission: 'settings.manage' }
```
(`Ruler` from `lucide-react`; swap for another lucide icon if a better fit exists.)

## Part 3 — Product form field → clean dropdown

- Fetch the **active units** server-side: add `getActiveUnits()` to
  [`src/data/products.ts`](../../../src/data/products.ts) (ordered by `sort_order`), and pass them
  from [`products/page.tsx`](../../../src/app/(authenticated)/products/page.tsx) into `ProductsClient`
  as a `units` prop (server-first, mirroring how `products` is passed).
- Replace the `Combobox` in the unit field with the existing Radix
  [`<Select>`](../../../src/components/ui/select.tsx), keeping the `per` prefix label:
  `Unit *  per [ tooth ▾ ]`. Options are the active unit labels.
- **Preserve the current value on edit:** if the product being edited has a `unit` that is not in
  the active list (deactivated or renamed away), include that stored value as an extra selectable
  option (labeled e.g. `tooth (inactive)`) so editing never silently drops or changes it.
- **New-product default:** `unit` if present in the active list, else the first active unit.
- The `unit` field still flows through the existing server normalization
  (`normalizeUnit` in `productInputSchema`) on save — unchanged.

## Part 4 — Cleanup

- Delete `src/components/ui/combobox.tsx`.
- Remove the `Combobox` import, the `UNIT_OPTIONS` constant, and the `Controller`-wrapped combobox
  usage from `ProductsClient.tsx` (replaced by the `<Select>` from Part 3). Keep the `Controller`
  import only if still needed for the Select binding.

---

## Files

| File | Change |
| --- | --- |
| SQL migration (new) | Create `units` table + RLS (mirror `work_stages`) + seed 7 values |
| `src/lib/database-generated.types.ts` | Regenerate (adds `units`) |
| `src/lib/database.types.ts` | Add `export type Unit = Tables<'units'>` |
| `src/app/(authenticated)/settings/units/page.tsx` | New — units manager (mirror work-stages, no color) |
| `src/domain/navigation.ts` | New "Units" entry under Lab Setup |
| `src/data/products.ts` | Add `getActiveUnits()` |
| `src/app/(authenticated)/products/page.tsx` | Fetch units, pass to `ProductsClient` |
| `src/components/products/ProductsClient.tsx` | Unit field → `<Select>` from `units`; preserve current value; drop `Combobox`/`UNIT_OPTIONS` |
| `src/components/ui/combobox.tsx` | Delete (unused after this change) |

## Backward compatibility

- Existing products keep their stored unit strings; the seed covers all current values, so every
  product's unit is a valid active option after the migration.
- A product whose unit is later deactivated/renamed still displays and edits correctly (Part 3's
  preserve-current-value rule).
- `products.unit` column type is unchanged (text), so no products migration and no risk to invoices
  (which don't reference `unit`).

## Verification

- Migration: `select label, sort_order, is_active from units order by sort_order` returns the seven
  seeded rows; RLS denies writes to a non-`settings.manage` user and allows them to one with it.
- Units manager: add a unit (e.g. `bridge`), rename it, reorder it, deactivate it — table updates;
  a non-permissioned user cannot reach `/settings/units`.
- Product form: the unit field is a dropdown of active units with the `per` prefix; a newly added
  unit appears in it; editing a product whose unit was deactivated still shows that value; saving
  stores the normalized label and the table shows `per {unit}`.
- `Combobox` deletion: `grep -rn Combobox src/` returns only the unrelated comment in
  `ProductSearchAdd.tsx`; `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build` pass.
