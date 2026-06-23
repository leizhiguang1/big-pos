# Payment Flow Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the invoice payment UI to a single "Record Payment" action that records the full outstanding balance and marks the invoice paid; remove the "Mark Paid" button and its now-dead server action.

**Architecture:** UI + server-action layer only. The existing atomic `record_payment` RPC stays the single payment path, called with `amount = unrecorded` (the full remaining balance). No database, RPC, status-enum, reports, or A/R-aging changes. The `partial` status and `mark_invoice_paid` RPC are left inert.

**Tech Stack:** Next.js (App Router), React, react-hook-form + zod, Tailwind, lucide-react, Supabase RPC. Tests via vitest.

## Global Constraints

- **UI/server-action layer only.** Do NOT modify the database, the `record_payment` / `mark_invoice_paid` RPCs, the `partial` status value, reports, status badges, or A/R aging.
- **`record_payment` is the only payment path.** The recorded amount is always `unrecorded` (`max(0, total − totalPaid)`) — the full remaining balance. The UI must make it impossible to record a partial amount.
- **No behavior change to domain/RPC logic.** Existing test suites (`vitest run`) must stay green — only a comment is edited in `src/lib/invoice-status.ts`.
- Currency is rendered with `formatCurrency` from `@/lib/utils`; the payment date defaults to `todayISODate()` from the same module.
- Dev server runs on **http://localhost:6060** (`npm run dev`) — used for manual verification.
- Verification commands: typecheck `npx tsc --noEmit`, lint `npm run lint`, tests `npm test` (alias for `vitest run`).

---

### Task 1: Single full-payment "Record Payment" action

Rewrite `ActionsBar` so "Record Payment" is the only money action: amount is shown read-only as the full balance, the editable amount input and over-payment guard are gone, and the "Mark Paid" button/handler are removed. Also stop passing the now-unused `outstanding` prop from the page. After this task, `markInvoicePaidAction` has no caller (it is removed in Task 2).

**Files:**
- Modify: `src/components/invoices/detail/ActionsBar.tsx`
- Modify: `src/app/(authenticated)/invoices/[id]/page.tsx:69`

**Interfaces:**
- Consumes: `recordPaymentAction(id, { amount, payment_date?, reference?, notes? })` from `@/data/invoice-actions` (unchanged); the `unrecorded: number` prop already passed to `ActionsBar`.
- Produces: `ActionsBarProps` no longer has an `outstanding` field. `paymentSchema` / `PaymentForm` no longer have an `amount` field.

- [ ] **Step 1: Update the file header comment**

In `src/components/invoices/detail/ActionsBar.tsx`, replace the top comment block (lines 3-8) with:

```tsx
// Header (number + status/overdue/voided/locked badges) and the workflow action
// bar: Mark Sent, Record Payment (dialog), Edit link, Print Invoice / Delivery,
// Void (dialog) and Restore. Each mutation calls a Server Action and reports
// through the toast; success triggers `router.refresh()` so the server re-renders
// with fresh data. Payment goes through the atomic `record_payment` RPC, which
// records the full outstanding balance and advances status — we never recompute
// status client-side.
```

- [ ] **Step 2: Drop the now-unused imports**

Change the lucide import (line 25) to remove `CheckCircle`:

```tsx
import { ArrowLeft, Printer, CreditCard, Ban, Pencil, Lock } from 'lucide-react'
```

Change the react-hook-form import (line 13) to remove `useWatch` and `Resolver` usage if `Resolver` is still needed — `Resolver` IS still needed (the resolver cast on line 74), so only remove `useWatch`:

```tsx
import { useForm, type Resolver } from 'react-hook-form'
```

Change the server-actions import (lines 29-33) to remove `markInvoicePaidAction`:

```tsx
import {
  markSentAction,
  recordPaymentAction,
} from '@/data/invoice-actions'
```

- [ ] **Step 3: Drop `amount` from the payment schema**

Replace the schema (lines 37-43) with:

```tsx
const paymentSchema = z.object({
  payment_date: z.string().min(1),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
type PaymentForm = z.infer<typeof paymentSchema>
```

- [ ] **Step 4: Remove the `outstanding` prop from the component contract**

Replace the props type (lines 47-56) with:

```tsx
export type ActionsBarProps = {
  invoice: InvoiceDetail
  customerName: string | null
  /** max(0, total - totalPaid) — the full balance recorded by Record Payment. */
  unrecorded: number
  /** Opens the print dialog owned by the document island. */
  onPrint: (mode: PrintMode) => void
}
```

And the function signature (line 58):

```tsx
export function ActionsBar({ invoice, customerName, unrecorded, onPrint }: ActionsBarProps) {
```

- [ ] **Step 5: Remove the `markingPaid` state and the over-amount form plumbing**

Delete the `markingPaid` state line (line 65):

```tsx
  const [markingPaid, setMarkingPaid] = useState(false)   // ← delete this line
```

Replace the `useForm` destructure + watch block (lines 71-78) with (drops `control`, `errors`, `useWatch`, `overAmount`):

```tsx
  const { register, handleSubmit, reset } = useForm<PaymentForm>({
    // Cast keeps RHF's Resolver generics aligned with the zod schema's inferred type.
    resolver: zodResolver(paymentSchema) as Resolver<PaymentForm>,
    defaultValues: { payment_date: todayISODate() },
  })
```

- [ ] **Step 6: Record the full balance, not a typed amount**

Replace `onRecordPayment` (lines 85-101) with (amount comes from `unrecorded`, not the form):

```tsx
  const onRecordPayment = async (data: PaymentForm) => {
    setSavingPayment(true)
    // The atomic RPC inserts the payment row AND advances status in one call;
    // amount is always the full outstanding balance. We refresh afterward —
    // no client-side status recompute.
    const res = await recordPaymentAction(invoice.id, {
      amount: unrecorded,
      payment_date: data.payment_date,
      reference: data.reference_number || undefined,
      notes: data.notes || undefined,
    })
    setSavingPayment(false)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    setPaymentOpen(false)
    reset()
    show({ variant: 'success', title: 'Payment recorded' })
    router.refresh()
  }
```

- [ ] **Step 7: Delete the `markAsPaid` handler**

Delete the entire `markAsPaid` function (lines 110-118):

```tsx
  const markAsPaid = async () => {
    setMarkingPaid(true)
    // mark_invoice_paid writes a balancing payment so sum(payments) === total.
    const res = await markInvoicePaidAction(invoice.id)
    setMarkingPaid(false)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Invoice marked as paid' })
    router.refresh()
  }
```

- [ ] **Step 8: Update the action buttons (drop Mark Paid, hide Record Payment when paid)**

Replace the Record Payment + Mark Paid button block (lines 183-195) with:

```tsx
        {/* Record Payment is the single settle action: it records the full
            outstanding balance and marks the invoice paid. Hidden once paid so
            a second full payment can't be recorded. */}
        {!voided && ['sent', 'partial', 'overdue'].includes(invoice.status) && (
          <Button variant="outline" size="sm" onClick={() => { reset({ payment_date: todayISODate() }); setPaymentOpen(true) }}>
            <CreditCard className="h-4 w-4 mr-2" />Record Payment
          </Button>
        )}
```

- [ ] **Step 9: Make the dialog amount read-only**

Replace the dialog `<form>` body (lines 259-286) with (amount is a read-only display, over-amount message gone, submit disabled when nothing is due):

```tsx
          <form onSubmit={handleSubmit(onRecordPayment)} className="space-y-4">
            <div className="space-y-1">
              <Label>Amount (MYR)</Label>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(unrecorded)}</p>
              <p className="text-xs text-muted-foreground">Full outstanding balance — recorded as a single payment.</p>
            </div>
            <div className="space-y-2">
              <Label>Payment Date *</Label>
              <Input type="date" {...register('payment_date')} />
            </div>
            <div className="space-y-2">
              <Label>Bank Transfer Reference</Label>
              <Input placeholder="e.g. TT123456" {...register('reference_number')} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes…" {...register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingPayment || unrecorded <= 0}>{savingPayment ? 'Saving…' : 'Record Payment'}</Button>
            </DialogFooter>
          </form>
```

- [ ] **Step 10: Stop passing `outstanding` to ActionsBar**

In `src/app/(authenticated)/invoices/[id]/page.tsx`, delete the `outstanding={outstanding}` prop line (line 69). Leave the `outstanding` const (lines 40) in place — it is still used for display at lines ~110 and ~168.

```tsx
      {/* before */}
        outstanding={outstanding}
        unrecorded={unrecorded}
      {/* after — delete the outstanding line, keep unrecorded */}
        unrecorded={unrecorded}
```

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, no errors. (If it reports `markInvoicePaidAction` is declared but unused, that's expected — it's removed in Task 2; an unused export is not a type error.)

- [ ] **Step 12: Lint**

Run: `npm run lint`
Expected: PASS (no errors). Confirms no unused imports/vars left behind (e.g. `CheckCircle`, `useWatch`, `errors`, `control`, `markingPaid`).

- [ ] **Step 13: Run the test suite**

Run: `npm test`
Expected: PASS — all existing suites green (no domain/RPC behavior changed).

- [ ] **Step 14: Manual UI verification**

Start the dev server: `npm run dev` (http://localhost:6060). Open an invoice in `sent` status and confirm:
- "Mark Paid" no longer appears anywhere on the page.
- "Record Payment" opens a dialog showing the amount as read-only text equal to the invoice total, with date + reference + notes fields.
- Submitting records the payment and the status badge becomes `paid`.
- On the now-`paid` invoice, "Record Payment" is no longer shown.

- [ ] **Step 15: Commit**

```bash
git add src/components/invoices/detail/ActionsBar.tsx "src/app/(authenticated)/invoices/[id]/page.tsx"
git commit -m "feat(payments): single full-payment Record Payment action

Remove the Mark Paid button; Record Payment now records the full
outstanding balance (read-only amount) and is hidden once paid.
Drops the editable amount field and over-payment guard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Remove the dead `markInvoicePaidAction` and correct stale comments

With no caller left, delete the server action and fix the two comments that still describe the old two-button model.

**Files:**
- Modify: `src/data/invoice-actions.ts` (remove `markInvoicePaidAction`, lines 185-198; update header comment lines 24-31)
- Modify: `src/lib/invoice-status.ts:21-34` (reword `nextStatusAfterPayment` doc comment)

**Interfaces:**
- Consumes: nothing new.
- Produces: `markInvoicePaidAction` no longer exported from `@/data/invoice-actions`. The `mark_invoice_paid` RPC in the database is untouched (left inert).

- [ ] **Step 1: Delete the `markInvoicePaidAction` server action**

In `src/data/invoice-actions.ts`, delete the whole function (lines 185-198):

```tsx
export async function markInvoicePaidAction(id: string, reference?: string): Promise<ActionResult> {
  const gate = await requirePermission('invoices.manage')
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin.rpc('mark_invoice_paid', {
    p_invoice_id: id,
    p_created_by: gate.userId,
    p_reference: reference,
  })
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}
```

- [ ] **Step 2: Update the action-permissions header comment**

In the same file, replace the `recordPaymentAction` + `markInvoicePaidAction` comment bullets (lines 24-31) with (drops the Mark Paid bullet; corrects the Record Payment status list to no longer include `paid`):

```tsx
// - recordPaymentAction       → invoices.manage
//     Record Payment button shows only for sent/partial/overdue invoices —
//     already-sent records, which canEditInvoice maps to invoices.manage
//     (docs/modules/permissions.md: manage = "already-sent billing records").
```

- [ ] **Step 3: Reword the `nextStatusAfterPayment` comment**

In `src/lib/invoice-status.ts`, replace the doc comment (lines 21-28) with (removes the inaccurate "Mark Paid shortcut, which records no payment rows" claim):

```tsx
/**
 * The status to write after recording a payment. `paidSum` is the total of all
 * recorded payment rows; `total` is the invoice total. A fully-covered invoice
 * becomes 'paid', otherwise 'partial'. An invoice already settled (status
 * 'paid') is never downgraded: logging a later payment must not flip it back to
 * partial.
 */
```

- [ ] **Step 4: Confirm no dangling references**

Run: `grep -rn "markInvoicePaidAction" src`
Expected: no matches (the import and call were removed in Task 1; this removes the definition + comment).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: PASS. (The `mark_invoice_paid` RPC integration tests in `src/integration/` still pass — the RPC itself is untouched.)

- [ ] **Step 8: Commit**

```bash
git add src/data/invoice-actions.ts src/lib/invoice-status.ts
git commit -m "refactor(payments): drop dead markInvoicePaidAction + fix stale comments

The Mark Paid UI is gone, so its server action has no caller. The
mark_invoice_paid DB RPC is left inert (optional future cleanup).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Do not touch the database.** The `mark_invoice_paid` and `record_payment` RPCs, the `partial` status, and the `src/integration/*payment*` tests are intentionally left as-is. Retiring `partial` and dropping `mark_invoice_paid` is a separate, optional future change (see the spec's "Optional future cleanup").
- If `npx tsc --noEmit` flags any leftover unused symbol in `ActionsBar.tsx` after Task 1 (e.g. `errors`, `control`, `outstanding`, `CheckCircle`, `useWatch`, `markingPaid`/`setMarkingPaid`), remove it — Steps 2/5 should already have, but the lint/typecheck steps are the backstop.
- Spec reference: `docs/superpowers/specs/2026-06-23-payment-flow-simplification-design.md`.
