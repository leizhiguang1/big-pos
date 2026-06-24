'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { BILLING_SETTINGS_ID, type BillingSettings } from '@/lib/config'
import {
  billingSettingsFromRow,
  normalizeBillingSettings,
  validateBillingSettings,
  type BillingSettingsInput,
} from '@/lib/billing-settings'
import type { TablesInsert } from '@/lib/database.types'

export async function getBillingSettings(): Promise<BillingSettings> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('lab_billing_settings')
    .select('bank_name, account_name, account_number, payment_note, invoice_notes, payment_terms_days')
    .eq('id', BILLING_SETTINGS_ID)
    .maybeSingle()

  if (error) return billingSettingsFromRow(null)
  return billingSettingsFromRow(data)
}

export async function updateBillingSettings(input: BillingSettingsInput): Promise<ActionResult> {
  const gate = await requirePermission('settings.manage')
  if (gate.ok === false) return fail(gate.error)

  const validationError = validateBillingSettings(input)
  if (validationError) return fail(validationError)

  const settings = normalizeBillingSettings(input)
  const update: TablesInsert<'lab_billing_settings'> = {
    id: BILLING_SETTINGS_ID,
    bank_name: settings.bankName,
    account_name: settings.accountName,
    account_number: settings.accountNumber,
    payment_note: settings.paymentNote,
    invoice_notes: settings.invoiceNotes,
    payment_terms_days: settings.paymentTermsDays,
    updated_by: gate.userId,
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('lab_billing_settings')
    .upsert(update, { onConflict: 'id' })

  if (error) return fail(error.message)

  revalidatePath('/settings/billing')
  revalidatePath('/invoices')
  return ok(undefined)
}
