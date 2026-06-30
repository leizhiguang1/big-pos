'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'
import { logInvoiceActivity } from '@/lib/audit/audit-log'
import { logServerError } from '@/lib/log'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function voidInvoice(input: { id: string; reason?: string }): Promise<ActionResult> {
  try {
    const gate = await requirePermission('invoices.manage')
    if (!gate.ok) return gate

    const admin = createAdminClient()
    const { data: inv } = await admin.from('invoices').select('invoice_number').eq('id', input.id).single()
    const { error } = await admin
      .from('invoices')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: gate.userId,
        void_reason: input.reason?.trim() || null,
      })
      .eq('id', input.id)
    if (error) {
      logServerError('voidInvoice', error, { id: input.id })
      return { ok: false, error: 'Could not void the invoice. Please try again.' }
    }
    await logInvoiceActivity({
      invoiceId: input.id, actorId: gate.userId, actorName: gate.actorName,
      action: 'invoice.voided', entityLabel: inv?.invoice_number ?? null,
      reason: input.reason?.trim() || null,
    })

    revalidatePath(`/invoices/${input.id}`)
    revalidatePath('/invoices')
    return { ok: true }
  } catch (e) {
    logServerError('voidInvoice', e, { id: input.id })
    return { ok: false, error: 'Could not void the invoice. Please try again.' }
  }
}
