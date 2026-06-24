'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'
import { logServerError } from '@/lib/log'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function voidInvoice(input: { id: string; reason?: string }): Promise<ActionResult> {
  try {
    const gate = await requirePermission('invoices.manage')
    if (!gate.ok) return gate

    const admin = createAdminClient()
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

    revalidatePath(`/invoices/${input.id}`)
    revalidatePath('/invoices')
    return { ok: true }
  } catch (e) {
    logServerError('voidInvoice', e, { id: input.id })
    return { ok: false, error: 'Could not void the invoice. Please try again.' }
  }
}
