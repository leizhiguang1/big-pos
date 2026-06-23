'use server'

// Reads + the WRITE action for the credits (account adjustments) module.
//
// A credit is a non-payment reduction of a clinic's account — remake / return /
// goodwill. It is NOT a payment and NOT a void. It reduces the clinic's account
// balance and appears in the statement ledger, but never touches an invoice's
// own paid/status math.
//
// WRITE pattern mirrors `recordPaymentAction` in `./invoice-actions.ts`:
//   1. `requirePermission('invoices.manage')` — the SAME gate payments use
//      (credits are a powerful billing action on already-issued accounts).
//   2. `createAdminClient()` — service-role client. The `credits` table has NO
//      authenticated write policy, so writes MUST go through the admin client.
//   3. `created_by` is taken from the session user (`gate.userId`), never the
//      client payload.
//   4. Authoritative re-validation with `creditInputSchema` before the insert.
//   5. revalidate the clinic detail + statement paths.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'
import { creditInputSchema, type CreditInput } from '@/domain/schemas'
import type { Credit } from '@/lib/database.types'

export type { Credit } from '@/lib/database.types'

export type ActionResult = { ok: true } | { ok: false; error: string }

// All credits for a clinic, oldest-first (ledger order). RLS allows any
// authenticated user to read, so the session client is sufficient here.
export async function getCreditsForCustomer(customerId: string): Promise<Credit[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('credits')
    .select('*')
    .eq('customer_id', customerId)
    .order('credit_date', { ascending: true })
  return (data ?? []) as Credit[]
}

// Issue an account credit for a clinic. `customerId` is server-trusted (it scopes
// the credit); the rest comes from the form and is re-validated authoritatively.
export async function createCreditAction(
  customerId: string,
  input: CreditInput,
): Promise<ActionResult> {
  const gate = await requirePermission('invoices.manage')
  if (gate.ok === false) return gate

  // Authoritative re-validation: never trust the client's shape.
  const parsed = creditInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid credit' }
  }
  const c = parsed.data

  const admin = createAdminClient()
  const { error } = await admin.from('credits').insert({
    customer_id: customerId,
    invoice_id: c.invoice_id ?? null,
    amount: c.amount,
    reason: c.reason,
    credit_date: c.credit_date,
    notes: c.notes?.trim() ? c.notes.trim() : null,
    created_by: gate.userId,
  })
  if (error) return { ok: false, error: error.message }

  // Refresh the clinic detail (account balance + credits card) and its statement.
  revalidatePath(`/customers/${customerId}`)
  revalidatePath(`/customers/${customerId}/statement`)
  return { ok: true }
}
