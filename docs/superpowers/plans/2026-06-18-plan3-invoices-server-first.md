# Plan 3 — Invoices Module, Server-First (Spec 1, Plan 3 of 4)

**Goal:** Move the entire invoices module behind the `src/data/` seam — reads as server query functions (Server Components), writes as Server Actions — so no component imports `@/lib/supabase` directly, the atomic payment RPCs from Plan 2 land in the UI (money model fixed), and feedback flows through the toast/error-boundary primitives. Behavior stays identical except payments become atomic.

**Why now:** This is the first real consumer of the `src/data/` layer and the highest-value module. It proves the foundation end-to-end.

## Established patterns (follow exactly)

- **Server reads:** `import { createClient } from '@/lib/supabase/server'` → `const supabase = await createClient()` (async, RLS-aware via session cookie). Used inside `src/data/*` query functions called from Server Components.
- **Server writes:** Server Action pattern from `src/lib/invoices/void-actions.ts`:
  ```ts
  'use server'
  const gate = await requirePermission('invoices.manage')   // from '@/lib/auth/require-permission'
  if (!gate.ok) return gate                                   // ActionResult: {ok:false,error}
  const admin = createAdminClient()                           // from '@/lib/supabase/admin'
  const { error } = await admin.from(...)...                  // gate.userId available for created_by
  if (error) return { ok:false, error: error.message }
  revalidatePath('/invoices'); revalidatePath(`/invoices/${id}`)
  return { ok:true }
  ```
- **ActionResult:** `type ActionResult = { ok:true } | { ok:false; error:string }` (extend with payload as needed, e.g. `{ ok:true; id:string }`).
- **Permissions:** reuse `canEditInvoice()` semantics server-side — `draft` → `invoices.edit`; `sent/partial/paid/overdue` → `invoices.manage`. Each task must map its action to the SAME permission the current UI uses (consult `docs/modules/permissions.md` + how the buttons gate today). Preserve current gating semantics.
- **Atomic RPCs (Plan 2):** record payment → `record_payment(p_invoice_id, p_amount, p_created_by, p_payment_date?, p_reference?, p_notes?)`; mark paid → `mark_invoice_paid(p_invoice_id, p_created_by, p_reference?)`. These REPLACE the detail page's insert-then-separately-update flow.
- **Feedback:** `useToast()` from `@/components/feedback/toast` in client islands — `show({title, variant:'success'|'error'})`. Replace inline `actionError` state.
- **Cache:** use `revalidatePath` (matches working void-actions). Note the README says `revalidateTag`; update the README to reflect `revalidatePath` reality.

## Architecture decisions

- **List** (`invoices/page.tsx`): → **Server Component** fetching `getInvoices()`; the search/status/work filters move into a small client island `InvoiceListClient` that filters the server-fetched array in memory (same UX as today).
- **Detail** (`invoices/[id]/page.tsx`, 1291 lines): → **Server Component shell** that fetches everything via `getInvoiceDetail(id)` and renders the printable document + read-only sections server-side. Each interactive section becomes a **client island** calling a Server Action: PaymentDialog, WorkStatusEditor, CaseDetailsEditor, ServiceStatusSelector, RecipientEditor, MarkSent button. PrintDialog stays client (no persistence). Void/Restore already are actions.
- **Form** (`InvoiceForm.tsx`, 602 lines): **stays a Client Component** (customer-sync, edit-lock, dynamic line items are genuinely interactive). Its reference-data reads move to `getInvoiceFormData()`/`getInvoiceForEdit()` passed as props from a server wrapper; its create/update RPCs move to `createInvoiceAction`/`updateInvoiceAction`.
- **No behavior change** other than: payments atomic via RPC; feedback via toast.

## Verification strategy

Data-layer functions are thin I/O wrappers — verified by **build + browser E2E** (Playwright, logged in as admin), not unit tests. Pure logic (billing/invoice-status/work-stages) is already unit-tested and must stay green. After each task: `npx tsc --noEmit` + `npm run lint` + `npx vitest run` green; after UI tasks, browser-verify the affected flow. Gate: `npm run build` green at the end.

---

## Task 1 — Data layer: reads (`src/data/invoices.ts`)

Server query functions using `await createClient()`:
- `getInvoices()` — `invoices` + `customers(clinic_name)` + `invoice_items(work_status)` + `service_statuses(*)`, ordered as the list does today. Returns typed array.
- `getInvoiceDetail(id)` — bundle `{ invoice (+customers,+service_statuses), items, payments, history, products, stages, serviceStatuses }` (the 6–7 reads the detail page does today, in parallel via `Promise.all`). Returns `null` if invoice missing.
- `getInvoiceFormData()` — `{ customers, products(active), serviceStatuses(active) }`.
- `getInvoiceForEdit(id)` — `{ invoice, items }` for edit prefill.

- [ ] Write the functions; export typed return shapes.
- [ ] `tsc`/`lint`/`vitest` green.
- [ ] Smoke: temporarily call `getInvoices()` from the list Server Component in Task 3 (verified there).
- [ ] Commit.

## Task 2 — Data layer: write actions (`src/data/invoice-actions.ts`)

`'use server'` actions, each gated + `revalidatePath`:
- `createInvoiceAction(payload)` → gate `invoices.edit` → `rpc('create_invoice_with_items', {p_invoice, p_items})` (inject `created_by: gate.userId`) → `{ok:true,id}`.
- `updateInvoiceAction(id, payload)` → gate per `canEditInvoice` semantics (load current status to pick edit vs manage) → `rpc('update_invoice_with_items', ...)`.
- `recordPaymentAction(id, {amount, payment_date, reference, notes})` → gate (same as current Record-Payment gating) → `rpc('record_payment', {p_invoice_id:id, p_amount:amount, p_created_by:gate.userId, ...})`.
- `markInvoicePaidAction(id, reference?)` → `rpc('mark_invoice_paid', {p_invoice_id:id, p_created_by:gate.userId, p_reference})`.
- `markSentAction(id)` → update `status:'sent'`.
- `updateWorkStatusAction(itemId, {work_status, stage_id})` → update `invoice_items` (history via trigger). (Shared with Plan 4.)
- `updateCaseDetailsAction(id, {patient, doctor})`.
- `updateServiceStatusAction(id, serviceStatusId|null)`.
- `saveRecipientAction(id, fields, alsoSaveToCustomer?, customerId?)`.
- Re-export `voidInvoice`/`restoreInvoice` from here (single import surface) or leave in place and document.

- [ ] Each action maps to the correct permission (consult permissions catalogue + current UI gating; preserve semantics).
- [ ] `tsc`/`lint`/`vitest` green. Commit.

## Task 3 — List page → Server Component + filter island

- [ ] `invoices/page.tsx` → Server Component: `const invoices = await getInvoices()`; render `<InvoiceListClient invoices={invoices} />`.
- [ ] `InvoiceListClient` (`'use client'`) holds search/status/work filter state + the table (move current JSX). No supabase import.
- [ ] Browser-verify: list renders, filters work, row-click navigates, overdue/voided badges correct.
- [ ] Commit.

## Task 4 — Detail page → Server Component shell + reads

- [ ] `invoices/[id]/page.tsx` → Server Component: `const data = await getInvoiceDetail(id)`; `notFound()` if null. Render the printable document + read-only header/line-items/payment-history/work-status-table server-side from `data`.
- [ ] Carve interactive sections into named client island components under `src/components/invoices/detail/` receiving `data` slices as props (islands wired in Task 5; scaffold them as presentational first so the page compiles + renders).
- [ ] Browser-verify: detail renders identically (document, totals, badges, history) read-only.
- [ ] Commit.

## Task 5 — Detail interactive islands → Server Actions + toast

Wire each island to its action, with `useToast` feedback + `router.refresh()`/revalidation:
- [ ] PaymentDialog → `recordPaymentAction` / `markInvoicePaidAction` (atomic RPCs). Verify: recording a payment creates a `payments` row AND advances status atomically; Mark Paid writes a balancing payment so `sum(payments)` == total.
- [ ] WorkStatusEditor → `updateWorkStatusAction` (+ history reload).
- [ ] CaseDetailsEditor (patient/doctor), ServiceStatusSelector, RecipientEditor, MarkSent button → respective actions.
- [ ] Void/Restore islands use existing actions.
- [ ] Replace all inline `actionError` with toast.
- [ ] Browser-verify EVERY mutation end-to-end (logged in as admin). **Use a throwaway draft invoice for payment tests; clean up after.**
- [ ] Commit.

## Task 6 — Form → data layer

- [ ] Server wrapper for `new` + `edit` pages fetches `getInvoiceFormData()` (+ `getInvoiceForEdit(id)` for edit) and passes as props.
- [ ] `InvoiceForm` drops its mount-time supabase reads (now props) and calls `createInvoiceAction`/`updateInvoiceAction` instead of `supabase.rpc(...)`. Keep all client interactivity (customer sync, edit-lock redirect, validation, line-item editor) intact.
- [ ] Toast on save success/failure; navigate on success.
- [ ] Browser-verify: create a new invoice (clean up), edit an existing draft, edit-lock on a sent invoice still redirects.
- [ ] Commit.

## Task 7 — Purge direct supabase + wire feedback shell

- [ ] `grep` invoice components for `@/lib/supabase` — zero direct imports remain (all via `src/data/`).
- [ ] Ensure ToastProvider + error-boundary wrap the invoice routes (already mounted in Plan 1 layout — confirm).
- [ ] Update `src/data/README.md` (revalidatePath note) + `docs/modules/billing.md` if flows changed. Commit.

## Task 8 — Full verification + review

- [ ] `npm run build`, `tsc`, `lint`, `vitest` all green.
- [ ] Browser QA sweep of every invoice flow: list/filter, create, edit, detail render, record payment (atomic), mark paid (balancing payment), work status, service status, case details, recipient, void/restore, print preview.
- [ ] `requesting-code-review` on the diff. Address findings.
- [ ] Commit; update progress ledger.

## Success criteria
- No invoice component imports `@/lib/supabase`; all access via `src/data/`.
- List + detail are Server Components; interactive bits are client islands calling Server Actions.
- Recording a payment and Mark Paid use the atomic RPCs; `sum(payments)` reconciles with status (money model fixed in UI).
- All flows browser-verified green; build/tsc/lint/tests green; code review clean.

## Not in this plan
- Work queue page (`/work`) — Plan 4.
- RLS/security hardening — Spec 5.
