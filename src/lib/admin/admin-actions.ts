'use server'

// Server Actions for the Super Admin Console. Every action:
//   1. gates on requireSuperadmin() — the console is Super-Admin-only.
//   2. uses the service-role admin client (RLS bypassed; code-gated).
//   3. writes an admin_audit_log row (who/what/when/why) via writeAuditLog.
//   4. revalidates affected routes.
// Narrow with `gate.ok === false` (strict) per the project's strict:false rules.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import { writeAuditLog, logInvoiceActivity } from '@/lib/audit/audit-log'
import { logServerError } from '@/lib/log'

export type ActionResult = { ok: true } | { ok: false; error: string }

function revalidateInvoiceViews(id: string) {
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/settings/admin')
}

// --- Invoices --------------------------------------------------------------

export async function softDeleteInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
  const { error } = await admin
    .from('invoices')
    .update({ deleted_at: new Date().toISOString(), deleted_by: gate.userId, delete_reason: input.reason?.trim() || null })
    .eq('id', input.id)
  if (error) {
    logServerError('softDeleteInvoiceAction', error, { id: input.id })
    return { ok: false, error: 'Could not delete the invoice. Please try again.' }
  }
  await writeAuditLog({
    actorId: gate.userId, action: 'invoice.soft_delete', entityType: 'invoice',
    entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.soft_deleted', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}

export async function restoreInvoiceAction(id: string): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', id).single()
  const { error } = await admin
    .from('invoices')
    .update({ deleted_at: null, deleted_by: null, delete_reason: null })
    .eq('id', id)
  if (error) {
    logServerError('restoreInvoiceAction', error, { id })
    return { ok: false, error: 'Could not restore the invoice. Please try again.' }
  }
  await writeAuditLog({
    actorId: gate.userId, action: 'invoice.restore', entityType: 'invoice',
    entityId: id, entityLabel: inv?.invoice_number ?? null,
  })
  await logInvoiceActivity({
    invoiceId: id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.restored', entityLabel: inv?.invoice_number ?? null,
  })
  revalidateInvoiceViews(id)
  return { ok: true }
}

// Undo a wrongful void. The prevent_invoice_restore trigger blocks clearing
// voided_at unless the app.allow_invoice_restore flag is set, which the
// admin_restore_void RPC does inside the same transaction.
export async function restoreVoidedInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
  const { error } = await admin.rpc('admin_restore_void', { p_id: input.id })
  if (error) {
    logServerError('restoreVoidedInvoiceAction', error, { id: input.id })
    return { ok: false, error: 'Could not restore the voided invoice. Please try again.' }
  }
  await writeAuditLog({
    actorId: gate.userId, action: 'invoice.void_restore', entityType: 'invoice',
    entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.void_restored', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
  })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}

// Permanent delete. invoice_items + payments cascade via ON DELETE CASCADE.
// A row snapshot is stored in the audit metadata for forensic recovery.
export async function purgeInvoiceAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('*').eq('id', input.id).single()
  const { error } = await admin.from('invoices').delete().eq('id', input.id)
  if (error) {
    logServerError('purgeInvoiceAction', error, { id: input.id })
    return { ok: false, error: 'Could not permanently delete the invoice. Please try again.' }
  }
  await writeAuditLog({
    actorId: gate.userId, action: 'invoice.purge', entityType: 'invoice',
    entityId: input.id, entityLabel: inv?.invoice_number ?? null, reason: input.reason,
    metadata: (inv ?? null) as Record<string, unknown> | null,
  })
  await logInvoiceActivity({
    invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
    action: 'invoice.purged', entityLabel: inv?.invoice_number ?? null, reason: input.reason,
    metadata: { snapshot: (inv ?? null) as Record<string, unknown> | null },
  })
  revalidateInvoiceViews(input.id)
  return { ok: true }
}

// --- Clinics (customers) ---------------------------------------------------

// Permanent delete of a clinic. Refused while any invoice or credit still
// references it (the FK is ON DELETE RESTRICT; we check first for a clear error).
// Clinics are soft-deleted via archived_at elsewhere; this is the Super Admin purge.
export async function purgeCustomerAction(input: { id: string; reason?: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (gate.ok === false) return gate

  const admin = createAdminClient()
  const [{ count: invCount }, { count: creditCount }] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', input.id),
    admin.from('credits').select('id', { count: 'exact', head: true }).eq('customer_id', input.id),
  ])
  if ((invCount ?? 0) > 0 || (creditCount ?? 0) > 0) {
    return { ok: false, error: `Clinic still has ${invCount ?? 0} invoice(s) and ${creditCount ?? 0} credit(s). Delete or reassign those first.` }
  }

  const { data: c } = await admin.from('customers').select('clinic_name').eq('id', input.id).single()
  const { error } = await admin.from('customers').delete().eq('id', input.id)
  if (error) {
    logServerError('purgeCustomerAction', error, { id: input.id })
    return { ok: false, error: 'Could not permanently delete the clinic. Please try again.' }
  }
  await writeAuditLog({
    actorId: gate.userId, action: 'customer.purge', entityType: 'customer',
    entityId: input.id, entityLabel: c?.clinic_name ?? null, reason: input.reason,
  })
  revalidatePath('/customers')
  revalidatePath('/settings/admin')
  return { ok: true }
}
