# Void Sales as Soft-Delete — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

Voiding a sale today is a single status flip: `invoices.update({ status: 'void' })`. This conflates two
unrelated ideas in one `status` column — the **financial lifecycle** (`draft/sent/partial/paid/overdue`)
and **cancellation**. Consequences:

- Voiding a `paid` invoice overwrites the fact that it was paid, so "un-voiding" is lossy.
- The "what counts toward revenue" rule is copy-pasted as inline string checks across the dashboard,
  reports, and customer pages — change it in one place, miss another.
- Payments belonging to a voided invoice are not explicitly excluded anywhere; they simply aren't summed
  in today's headline numbers, which is luck, not design.

## Goal

Make voiding behave like a **soft-delete / cancel**, such that **counting and un-counting an invoice is a
lossless, one-field toggle**, and every report consistently ignores voided invoices and their payments.

## Decisions (locked)

1. **Counting basis:** invoice-basis (unchanged). Revenue = `sum(total)` of invoices that count.
2. **Void = cancel = soft-delete.** No separate `refunded` status; no negative refund rows; payments are
   neither deleted nor reversed — they simply stop counting because their invoice is voided.
3. **Void lives in its own column,** not in `status` (Approach A). `status` returns to meaning only the
   financial lifecycle.
4. **Keep audit fields** (`voided_by`, `void_reason`).
5. **Admin-only** void and restore, enforced in UI and via RLS.

## Data model

Migration on `public.invoices`:

- `voided_at timestamptz NULL` — the soft-delete marker. `NULL` = active; non-null = voided.
- `voided_by uuid NULL REFERENCES auth.users(id)` — who voided.
- `void_reason text NULL` — optional free-text reason.

Constraint + type changes:

- Replace `invoices_status_check` to allow `('draft','sent','partial','paid','overdue')` — i.e. **drop
  `'void'`** from the allowed values. There are zero `void` rows in the DB today, so no data migration is
  needed.
- `InvoiceStatus` in `src/lib/database.types.ts` drops `'void'`; add `voided_at`, `voided_by`, `void_reason`
  to the `Invoice` interface (and Insert/Update types as appropriate).

## Predicate module — `src/lib/invoice-status.ts` (new)

Single source of truth for "what counts." All reporting code imports from here.

```ts
export const isVoided = (inv: Pick<Invoice, 'voided_at'>) => inv.voided_at != null
export const countsAsRevenue = (inv: Pick<Invoice, 'voided_at' | 'status'>) =>
  !isVoided(inv) && inv.status === 'paid'
export const isOutstanding = (inv: Pick<Invoice, 'voided_at' | 'status'>) =>
  !isVoided(inv) && (['sent', 'partial', 'overdue'] as const).includes(inv.status as any)
```

(Exact helper surface can be refined during implementation; the requirement is that the rules exist in one
module and are reused.)

## Call sites to update (the "other places must not count it")

Reporting / counting:
- `src/app/(authenticated)/dashboard/page.tsx` — revenue (`status === 'paid'`) and outstanding
  (`['sent','partial','overdue']`) → use `countsAsRevenue` / `isOutstanding`. Also select `voided_at` in
  the query (currently selects only `total, status, due_date`).
- `src/app/(authenticated)/reports/page.tsx` — paid totals + outstanding (two sites) → use helpers; select
  `voided_at`.
- `src/app/(authenticated)/customers/[id]/page.tsx` — outstanding calc → use helpers; select `voided_at`.
- `src/app/(authenticated)/work/page.tsx` — replace `status !== 'void'` with `voided_at == null`.
- **Payments:** any aggregation that sums `payments` must exclude payments whose invoice is voided. None
  exist in headline reports today; this is a forward-looking rule to enforce wherever payment sums appear.

Void-state behavior (was keyed off `status === 'void'`, must move to `voided_at`):
- `src/lib/invoice-permissions.ts` — `canEditInvoice(status, role)` currently locks editing when
  `status === 'void'`. Voided is no longer a status, so this must also receive voided state. Change to
  accept the invoice (or a `voided` boolean) and lock when `isVoided(inv)`; keep the existing draft/admin
  rules for the financial status.
- `src/app/(authenticated)/invoices/page.tsx` (list) — `STATUS_VARIANT` includes a `void` key, the status
  filter has a `void` `SelectItem`, and filtering is `inv.status === statusFilter`. Replace the "Void"
  filter option so it filters on `voided_at != null`, and render the separate "Voided" indicator instead of
  a `void` status badge.
- `src/app/(authenticated)/invoices/[id]/page.tsx` (detail) — all `status === 'void'` / `status !== 'void'`
  checks (watermark, action-bar gating, void button, dialog) move to `isVoided()`; add the Restore action.

## Void / restore actions

In `src/app/(authenticated)/invoices/[id]/page.tsx`:

- **Void:** set `voided_at = now()`, `voided_by = <current user>`, `void_reason = <optional>`. `status` is
  left untouched.
- **Restore (un-void):** clear all three fields. Invoice instantly returns to its real financial state.
  Button shown only when the invoice is voided.
- Both actions admin-only.

## UI changes

- Void dialog gains an optional **reason** field.
- "VOID" watermark, and the disabling of edit / record-payment / mark-paid / status controls, key off
  `isVoided()` instead of `status === 'void'`.
- Financial status badge stays as-is; add a separate **"Voided"** indicator when soft-deleted.
- Invoices list: the "Voided" filter keys off `voided_at`; voided invoices remain visible (greyed/marked)
  and printable, matching current UX.
- Restore button appears (admin-only) on voided invoices.

## Permissions

- UI: void and restore controls only render for admins (`profiles.role === 'admin'` / existing `is_admin()`).
- RLS: add/adjust policy so that updating `voided_at` (set or clear) is permitted only for admins. Other
  invoice updates keep their current policy.

## Non-goals

- No `refunded` status, no negative/refund payment rows, no payment deletion.
- No cash-basis revenue, no reconciliation reporting.
- No changes to inventory (there is none).

## Risks / edge cases

- **Double source of truth:** removing `'void'` from the `status` enum is what prevents this; all code paths
  that set `status='void'` must be migrated to `voided_at` in the same change.
- **Voided + paid:** payments remain visible on the invoice for audit but must not count anywhere.
- **Restore correctness:** because `status` is never overwritten, restore needs no reconstruction logic.
- **RLS vs UI:** UI hiding is not security; the RLS policy is the real gate.

## Verification

- A voided `paid` invoice drops out of dashboard revenue and reports; restoring it brings it back unchanged.
- A voided invoice's payments are excluded from any payment sum.
- Work page hides items of voided invoices.
- Non-admin cannot void or restore (UI absent and RLS rejects the update).
- No remaining references to `status === 'void'` anywhere in the codebase.
