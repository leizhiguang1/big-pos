# Payment flow simplification — one settle action, full payment only

**Date:** 2026-06-23
**Status:** Design — pending review
**Branch:** feat/redesign-program

## Problem

The invoice detail page exposes two payment actions whose relationship is unclear
to users:

- **Record Payment** — opens a dialog, you type an amount (supports partial), records
  a `payments` row, and advances status to `partial` or `paid`.
- **Mark Paid** — a one-click shortcut that writes a *balancing* payment for the
  outstanding amount and flips status to `paid`.

Two buttons that both "take money and settle the invoice" invite the question *which
one do I press, and what's the difference?* The label "Mark Paid" also hides that it
creates a payment record (with no bank reference, stamped `"Marked as paid"`).

In practice this lab collects the **full invoice amount in one payment** — clinics do
not pay in instalments. The A/R aging model already assumes this: it buckets the full
invoice total, never a net-of-partial balance ([invoice-status.ts:69-93](../../../src/lib/invoice-status.ts#L69-L93)).
So partial payments are a capability nobody uses, and the second button is noise.

## Goal

Collapse to **one** money action. A clinic pays the whole invoice; you record it with
the bank reference; the invoice becomes `paid`. No partial entry, no second button.

## Decision

Change the **UI and server-action layer only**. Leave the database — the `partial`
status, the `record_payment` RPC, and the `mark_invoice_paid` RPC — untouched.

Rationale: nothing will ever *create* a partial invoice once the UI can't, so the
`partial` status simply becomes a state the app never enters. Removing it from the DB
would touch the status enum, reports, A/R aging, status badges, and the integration
test suite — a large, risky change for no user-facing benefit. We keep that as an
optional future cleanup (see below).

## Design

### The single action: "Record Payment"

Shown only while the invoice is unpaid — `sent`, `partial`, or `overdue`. Hidden for
`draft` (nothing to pay yet) and `paid` (already settled).

> `partial` stays in the visibility list purely so any *legacy* partial invoice in
> existing data can still be cleared. New invoices never reach `partial`.

The dialog records the **full remaining balance** as a single payment:

- **Amount** — displayed **read-only** as the remaining balance (`unrecorded` =
  `max(0, total − totalPaid)`). For a normal invoice with no prior payments this is
  the full total. It is *not* an editable input — the user can no longer type a partial
  amount. Shown as e.g. *"Amount due: RM100.00"*.
- **Payment date** — editable, defaults to today.
- **Reference number** — editable (the bank reference). Captured at payment time, so
  the old "log a reference after it's already paid" workflow is no longer needed.
- **Notes** — editable, optional.

Submit calls the existing `recordPaymentAction(invoice.id, { amount: unrecorded,
payment_date, reference, notes })`, which routes to the atomic `record_payment` RPC.
Because `amount` equals the full remaining balance, the RPC sets status to `paid`
(`paid_sum >= total`). No client-side status recompute.

Defensive: if `unrecorded <= 0`, disable submit (nothing to record). Normal flow never
hits this.

### What gets removed

In [src/components/invoices/detail/ActionsBar.tsx](../../../src/components/invoices/detail/ActionsBar.tsx):
- The **Mark Paid** button and its `markAsPaid` handler + `markingPaid` state.
- The `markInvoicePaidAction` import.
- The editable **amount `<Input>`**, the `paymentSchema.amount` field, the `useWatch`
  `watchedAmount`, and the `overAmount` over-payment guard — all obsolete once the
  amount is fixed to the full balance.
- The now-unused `CheckCircle` icon import (and `outstanding` prop if nothing else
  consumes it after the `overAmount` removal — verify during implementation).

In [src/data/invoice-actions.ts](../../../src/data/invoice-actions.ts):
- The `markInvoicePaidAction` server action and its entry in the header comment block.

### Comment corrections

- [src/lib/invoice-status.ts:21-34](../../../src/lib/invoice-status.ts#L21-L34) — the
  `nextStatusAfterPayment` doc references the "Mark Paid" shortcut "which records no
  payment rows." That was always inaccurate (the RPC wrote a balancing row) and the
  feature is now gone. Reword to describe the rule generically: *an already-`paid`
  invoice is never downgraded by a later payment.* Keep the never-downgrade guard — it
  is still sound defensive logic.
- [ActionsBar.tsx:1-8](../../../src/components/invoices/detail/ActionsBar.tsx#L1-L8) —
  the file header lists "Mark Paid" and `mark_invoice_paid`. Update to reflect the
  single `record_payment` action.

### Untouched (deliberately)

- **Database:** `partial` status, `record_payment`, and `mark_invoice_paid` RPCs all
  remain. `mark_invoice_paid` is already `revoke`d from `authenticated`/`anon`
  ([20260619000000_rls_permission_enforcement.sql:112](../../../supabase/migrations/20260619000000_rls_permission_enforcement.sql#L112)),
  so leaving it is inert.
- **Integration tests:** `payment-rpcs.integration.test.ts` and `rls.integration.test.ts`
  exercise the RPCs at the DB level, which is unchanged — they keep passing as-is.
- **Domain/unit logic:** `nextStatusAfterPayment`, `arAging`, reports, status badges —
  all unchanged in behavior (only a comment edited).

## Optional future cleanup (out of scope)

If you later want a *truly* partial-free system, a separate change can:
- drop the `mark_invoice_paid` RPC (migration),
- retire the `partial` value from the invoice status enum/type and the code paths that
  branch on it (badges, reports, aging, the visibility list above),
- update/remove the partial-payment integration tests.

Tracked as a follow-up, not part of this work.

## Testing

- **Manual:** create invoice → Mark as Sent → Record Payment shows full balance read-only,
  accepts date + reference → submit → status `paid`, payment row has the reference.
  Confirm Mark Paid no longer appears anywhere, and Record Payment is hidden on a `paid`
  invoice.
- **Type/lint:** `npm run typecheck` + lint clean after removing the action and form field.
- **Existing suites:** unchanged DB/unit tests still pass (RPCs untouched).

## Out of scope

- Editing or deleting a recorded payment after the fact.
- Backfilling references on invoices settled via the old Mark Paid path.
- Any change to how revenue, statements, or A/R aging are computed.
