'use server'

// Server Actions (WRITES) for the invoices module.
//
// Pattern (from `src/lib/invoices/void-actions.ts`):
//   1. `requirePermission(key)` — server-side gate (DB is source of truth).
//   2. `if (!gate.ok) return gate` — short-circuits with the ActionResult error.
//   3. `createAdminClient()` — service-role client (RLS-bypassing); `gate.userId`
//      supplies the acting user for `created_by` columns.
//   4. mutate, then `revalidatePath('/invoices')` + `revalidatePath('/invoices/${id}')`.
//   5. return an `ActionResult`.
//
// ---------------------------------------------------------------------------
// PERMISSION MAPPING — each action gates to the SAME permission the current UI
// requires today (evidence in parentheses):
//
// - createInvoiceAction       → invoices.edit
//     Plan Task 1; matches the "Create & edit draft invoices" capability. Form's
//     Create buttons sit behind the route's `invoices.view`+edit affordance.
// - updateInvoiceAction       → canEditInvoice semantics: draft → invoices.edit,
//     else → invoices.manage. (InvoiceForm edit-lock uses `canEditInvoice`, which
//     is draft→edit / sent→manage — see src/lib/invoice-permissions.ts. We load
//     the current status server-side to choose.)
// - recordPaymentAction       → invoices.manage
//     Record Payment button shows only for sent/partial/overdue/paid invoices
//     ([id]/page.tsx line ~672) — i.e. already-sent records, which canEditInvoice
//     maps to invoices.manage (docs/modules/permissions.md: manage = "already-sent
//     billing records").
// - markInvoicePaidAction     → invoices.manage
//     Mark Paid shows only for sent/partial/overdue ([id]/page.tsx line ~678) —
//     same already-sent tier → invoices.manage.
// - markSentAction            → invoices.edit
//     Mark as Sent shows only for draft invoices ([id]/page.tsx line ~667).
//     Acting on a draft → invoices.edit (canEditInvoice draft branch).
// - updateWorkStatusAction    → invoices.view
//     The Work Status dropdown is NOT gated by canEditInvoice or hasPermission
//     today — it renders for any non-void invoice ([id]/page.tsx line ~803), so
//     anyone with route/section access (invoices.view) can change it. (Shared with
//     Plan 4's work queue, where lab staff update status.)
// - updateCaseDetailsAction   → canEditInvoice semantics (draft→edit / else→manage)
//     Patient/Doctor inputs render editable only when `canEdit` is true
//     ([id]/page.tsx lines ~730/743).
// - updateServiceStatusAction → canEditInvoice semantics (draft→edit / else→manage)
//     The Service Status section is inside the same `!voided` block; its writes
//     follow the same content-edit gate. (canEditInvoice is the page's content
//     boundary — comment at [id]/page.tsx line ~626.)
// - saveRecipientAction       → canEditInvoice semantics (draft→edit / else→manage)
//     The recipient edit pencil renders only when `canEdit` is true
//     ([id]/page.tsx line ~470). alsoSaveToCustomer mirrors saveRecipient().
//
// NOTE: actions whose permission depends on invoice status load the current
// `status` + `voided_at` and apply `canEditInvoice` server-side via a tiny
// `gateForContentEdit` helper, so the server enforces the exact UI rule.
// ---------------------------------------------------------------------------

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/require-permission'
import type { PermissionCheck } from '@/lib/auth/require-permission'
import { isVoided } from '@/lib/invoice-status'
import { hold } from '@/domain/production'
import type { Json, TablesUpdate, WorkStatus } from '@/lib/database.types'

export type ActionResult = { ok: true } | { ok: false; error: string }
export type CreateResult = { ok: true; id: string } | { ok: false; error: string }

// Void/restore live in `@/lib/invoices/void-actions` — import them directly.
// (A 'use server' file may only export async functions, so we can't re-export here.)

// Shape the create/update form sends for the invoice header. Mirrors
// `InvoiceForm.invoicePayload()`. Status + created_by are added server-side.
export type InvoicePayload = {
  customer_id: string
  invoice_date: string
  due_date: string
  notes: string | null
  patient: string | null
  doctor: string | null
  service_status_id: string | null
  bill_to_name: string | null
  bill_to_contact: string | null
  bill_to_phone: string | null
  billing_address: string | null
  ship_to_name: string | null
  ship_to_contact: string | null
  delivery_address: string | null
  subtotal: number
  total: number
}

// Line item the create/update RPC diffs. `id` is null for new rows.
// `work_note` is the per-line internal remark (lab notes); the RPCs persist it
// onto invoice_items.work_note. Optional/nullable — empty becomes NULL.
export type InvoiceItemPayload = {
  id?: string | null
  product_id: string | null
  description: string
  quantity: number
  unit_price: number
  amount: number
  work_note?: string | null
}

// Revalidate both the list and the specific invoice's detail page.
function revalidateInvoice(id: string) {
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${id}`)
}

// Content-edit gate: replicate `canEditInvoice` server-side. Loads the invoice's
// current status + void marker, then requires invoices.edit for drafts and
// invoices.manage for already-sent (or voided → locked for everyone).
async function gateForContentEdit(id: string): Promise<PermissionCheck> {
  // Server-trusted lookup of status + void marker via the admin client (the
  // role/permission enforcement still happens in requirePermission below).
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select('status, voided_at')
    .eq('id', id)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Invoice not found' }
  if (isVoided(data)) return { ok: false, error: 'This invoice is voided and cannot be edited.' }
  return requirePermission(data.status === 'draft' ? 'invoices.edit' : 'invoices.manage')
}

export async function createInvoiceAction(payload: {
  p_invoice: InvoicePayload & { status: 'draft' | 'sent' }
  p_items: InvoiceItemPayload[]
}): Promise<CreateResult> {
  const gate = await requirePermission('invoices.edit')
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  // Single transactional RPC: header + items succeed or fail together. We inject
  // the acting user as created_by; status comes from the caller (draft/sent).
  const { data, error } = await admin.rpc('create_invoice_with_items', {
    p_invoice: { ...payload.p_invoice, created_by: gate.userId } as unknown as Json,
    p_items: payload.p_items as unknown as Json,
  })
  if (error || !data) return { ok: false, error: error?.message ?? 'Failed to create invoice' }
  revalidatePath('/invoices')
  return { ok: true, id: data as string }
}

export async function updateInvoiceAction(
  id: string,
  payload: { p_invoice: InvoicePayload; p_items: InvoiceItemPayload[] },
): Promise<ActionResult> {
  const gate = await gateForContentEdit(id)
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin.rpc('update_invoice_with_items', {
    p_invoice_id: id,
    p_invoice: payload.p_invoice as unknown as Json,
    p_items: payload.p_items as unknown as Json,
  })
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}

export async function recordPaymentAction(
  id: string,
  input: { amount: number; payment_date?: string; reference?: string; notes?: string },
): Promise<ActionResult> {
  const gate = await requirePermission('invoices.manage')
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin.rpc('record_payment', {
    p_invoice_id: id,
    p_amount: input.amount,
    p_created_by: gate.userId,
    p_payment_date: input.payment_date,
    p_reference: input.reference,
    p_notes: input.notes,
  })
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}

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

export async function markSentAction(id: string): Promise<ActionResult> {
  // Route through the content-edit gate so a voided draft can't be marked sent
  // (it also yields invoices.edit for a draft, matching the original UI gating).
  const gate = await gateForContentEdit(id)
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin.from('invoices').update({ status: 'sent' }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}

export async function updateWorkStatusAction(
  itemId: string,
  input: { work_status: WorkStatus; stage_id: string | null },
): Promise<ActionResult> {
  const gate = await requirePermission('invoices.view')
  if (!gate.ok) return gate

  // Use the SSR (session) client, NOT the admin client: RLS's authenticated_all
  // policy permits this write, and keeping the user's auth context lets the
  // history trigger (auth.uid()/auth.jwt()) record WHO made the change. The
  // admin client has no session, which would log a null actor.
  const supabase = await createClient()

  // Read the item's CURRENT work_status to drive the on_hold round-trip
  // (`production.ts` `hold()`/`resume()`). Moving INTO on_hold from a non-hold
  // status remembers where to return to; moving OFF on_hold clears the memory.
  const { data: current, error: readErr } = await supabase
    .from('invoice_items')
    .select('work_status, resume_status')
    .eq('id', itemId)
    .single()
  if (readErr || !current) return { ok: false, error: readErr?.message ?? 'Work item not found' }

  // - entering on_hold from a non-hold status → remember it (hold().resumeFrom)
  // - re-selecting on_hold while already on_hold → PRESERVE the remembered status
  //   (don't let a misclick wipe where to resume to)
  // - any non-hold target → forget the remembered status
  const resume_status: WorkStatus | null =
    input.work_status === 'on_hold'
      ? current.work_status === 'on_hold'
        ? (current.resume_status as WorkStatus | null)
        : hold(current.work_status).resumeFrom
      : null

  // The DB trigger logs history + stamps work_status_updated_at; we only write
  // the change. Return the affected invoice id so the caller can revalidate.
  const { data, error } = await supabase
    .from('invoice_items')
    .update({ work_status: input.work_status, stage_id: input.stage_id, resume_status })
    .eq('id', itemId)
    .select('invoice_id')
    .single()
  if (error) return { ok: false, error: error.message }
  if (data?.invoice_id) revalidateInvoice(data.invoice_id)
  return { ok: true }
}

export async function updateCaseDetailsAction(
  id: string,
  input: { patient: string | null; doctor: string | null },
): Promise<ActionResult> {
  const gate = await gateForContentEdit(id)
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({ patient: input.patient, doctor: input.doctor })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}

export async function updateServiceStatusAction(id: string, serviceStatusId: string | null): Promise<ActionResult> {
  const gate = await gateForContentEdit(id)
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({ service_status_id: serviceStatusId })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoice(id)
  return { ok: true }
}

// Recipient (Bill To / Deliver To) fields written onto the invoice. Mirrors the
// detail page's `saveRecipient()` field set.
export type RecipientFields = {
  bill_to_name: string | null
  bill_to_contact: string | null
  bill_to_phone: string | null
  billing_address: string | null
  ship_to_name: string | null
  ship_to_contact: string | null
  delivery_address: string | null
}

export async function saveRecipientAction(
  id: string,
  fields: RecipientFields,
  opts?: { alsoSaveToCustomer?: boolean; customerId?: string },
): Promise<ActionResult> {
  const gate = await gateForContentEdit(id)
  if (!gate.ok) return gate

  const admin = createAdminClient()
  const { error } = await admin.from('invoices').update(fields).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Optionally push the Bill To values + both addresses to the customer master,
  // mirroring saveRecipient(): clinic_name is only overwritten when a name is set.
  if (opts?.alsoSaveToCustomer && opts.customerId) {
    const customerUpdate: TablesUpdate<'customers'> = {
      contact_person: fields.bill_to_contact,
      phone: fields.bill_to_phone,
      billing_address: fields.billing_address,
      delivery_address: fields.delivery_address,
    }
    if (fields.bill_to_name) customerUpdate.clinic_name = fields.bill_to_name
    const { error: custErr } = await admin
      .from('customers')
      .update(customerUpdate)
      .eq('id', opts.customerId)
    if (custErr) return { ok: false, error: custErr.message }
  }

  revalidateInvoice(id)
  return { ok: true }
}
