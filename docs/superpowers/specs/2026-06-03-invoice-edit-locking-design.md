# Invoice Edit Locking — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

Invoices have a lifecycle: `draft → sent → partial → paid → overdue`, plus `void`. Today the
**Edit** button — and the inline content edits on the detail page — are available for any invoice
that is not `void`. That means a sent invoice (already delivered to the customer) can be freely
edited by anyone.

The desired rule:

- A **draft** invoice can be edited by anyone (staff or admin).
- Once an invoice is **sent** (or beyond: `partial`, `paid`, `overdue`), it is **locked** for
  normal staff.
- An **admin** can still edit a locked invoice — this is the intentional override "for our own
  admin."
- A **void** invoice stays locked for everyone (terminal, unchanged from today).

We also want to confirm the existing **draft** editing flow works correctly end-to-end.

## Goals

- Lock content editing of non-draft invoices for staff.
- Allow `role === 'admin'` to edit any non-void invoice (override).
- Keep workflow/status actions available to staff regardless of status.
- Verify and harden the existing draft edit round-trip.

## Non-Goals (out of scope)

- **No admin-assignment UI.** Admins are marked manually in Supabase (`user_metadata.role = "admin"`)
  for now. A future "employee creation module" will own role management.
- **No server-side / RLS enforcement.** This is UI gating only. A technically capable user could
  bypass it via direct API calls; that is an accepted trade-off for now and a clean follow-up later.
- **No schema changes, no new dependencies.**
- **No new workflow actions** (payments, void, status transitions stay as they are).

## The Permission Rule

A single source of truth, used everywhere editing is gated.

New file: `src/lib/invoice-permissions.ts`

```ts
import type { InvoiceStatus } from '@/lib/database.types'

/** Whether invoice content (header fields, line items, recipient, patient/doctor) may be edited. */
export function canEditInvoice(status: InvoiceStatus, role: string): boolean {
  if (status === 'void') return false        // terminal — locked for everyone
  return status === 'draft' || role === 'admin'
}
```

- `role` comes from the existing `useAuth()` context (`src/contexts/AuthContext.tsx`), which reads
  `session.user.user_metadata.role` and defaults to `'staff'`.
- `'admin'` is the only privileged value checked. Any other value behaves as staff.

## Behavior — Two Buckets

### Bucket A: Content editing — gated by `canEditInvoice`

These are the only affordances that change. When `canEditInvoice` is false:

| Affordance | Location | Locked behavior |
|---|---|---|
| **Edit** button | `src/app/(authenticated)/invoices/[id]/page.tsx` (~L594) | Hidden |
| **Patient / Doctor** inline inputs (Case Details) | same file (~L626–L648) | Rendered read-only (plain text, no `<Input>`, no blur-save) |
| **Edit recipient** pencil in doc body | same file (~L406–L411) | Hidden |
| Direct nav to `/invoices/[id]/edit` | `src/components/invoices/InvoiceForm.tsx` | After the invoice loads, if `!canEditInvoice(status, role)` redirect back to `/invoices/[id]` |

When locked, the detail page shows a small, unobtrusive **"Locked"** hint (e.g. near the status
badge or Case Details) explaining that sent invoices can only be edited by an admin. Exact placement
is an implementation detail; keep it minimal.

### Bucket B: Workflow / status actions — unchanged

These remain available to staff at the same statuses as today:

- **Mark as Sent** (draft only)
- **Record Payment**, **Mark Paid** (`sent` / `partial` / `overdue`)
- **Print Invoice**, **Print Delivery Note** (any status)
- **Void** (any non-void status) — stays available to staff. Voiding is a status change, not a
  content edit; making it admin-only is explicitly out of scope for this change.

### Admin override UX

When an admin opens the edit form for a non-draft invoice, show a subtle banner in the form, e.g.
"You're editing a **sent** invoice (admin override)." This makes the override visible and
intentional. No behavior change beyond the banner — the form saves the same way it does today.

## Draft Edit Verification / Hardening

Drafts are already editable via the unified `InvoiceForm`. This part is verification, with fixes if
anything is broken:

1. Create an invoice as **draft** → open **Edit** → change header fields (dates, customer, notes,
   patient/doctor) → **Save** → all values persist.
2. On a draft, **add / remove / edit line items** → Save → the add/update/delete diffing in
   `InvoiceForm` persists exactly the intended set.
3. **Recipient / address** edits on a draft persist and are not clobbered by customer auto-fill on
   reload (the existing `recipientSyncRef` guard).
4. Draft → **Mark as Sent** transition still works, and afterward the invoice correctly locks for
   staff (Edit hidden, Case Details read-only) while admin can still edit.

## Edge Cases

- **Unauthenticated / role still loading:** treat as staff (not admin). `useAuth` exposes `loading`;
  gate only after auth resolves so the override isn't denied to an admin mid-load. If a redirect
  guard runs while loading, wait for `loading === false` before deciding.
- **Void invoice + admin:** still not editable (`canEditInvoice` returns false for `void`
  regardless of role).
- **Unknown role string:** anything other than `'admin'` is treated as staff.
- **Deep link to edit page by staff on a sent invoice:** caught by the `InvoiceForm` guard →
  redirect to detail. (UI-only; not a security boundary.)

## Files Touched

- `src/lib/invoice-permissions.ts` — **new**, the `canEditInvoice` helper.
- `src/app/(authenticated)/invoices/[id]/page.tsx` — gate Edit button, Case Details inputs, and the
  recipient pencil with `canEditInvoice`; add the "Locked" hint.
- `src/components/invoices/InvoiceForm.tsx` — add the post-load redirect guard and the admin-override
  banner.

## Acceptance Criteria

- Staff viewing a **draft**: can edit (Edit button, Case Details, recipient) — unchanged.
- Staff viewing **sent / partial / paid / overdue**: Edit hidden, Case Details + recipient
  read-only; can still Record Payment / Mark Paid / Print / Void / Mark as Sent as applicable.
- Staff deep-linking to `/invoices/[id]/edit` on a non-draft: redirected to the detail page.
- Admin viewing any **non-void** invoice: full editing available, with an override banner on
  non-draft invoices.
- Anyone viewing a **void** invoice: no content editing (unchanged).
- Draft edit round-trip (header, line items, recipient) verified working.
