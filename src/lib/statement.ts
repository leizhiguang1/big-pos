/**
 * Pure helper for building an open-item Statement of Account.
 *
 * No database calls — accepts raw rows and returns a derived statement
 * object suitable for rendering or testing.
 */

import { differenceInCalendarDays } from 'date-fns'
import type { ArAging } from './invoice-status'

// ── Input types ──────────────────────────────────────────────────────────────

export type StatementInvoiceRow = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  patient: string | null
  total: number
  status: string
  voided_at: string | null
}

export type StatementPaymentRow = {
  invoice_id: string
  amount: number
}

export type StatementCreditRow = {
  credit_date: string
  amount: number
  reason: string
  // Optional invoice link — a credit may be clinic-level (null) or against a
  // specific invoice. The statement shows the invoice number when present.
  invoice_id?: string | null
}

// ── Output types ─────────────────────────────────────────────────────────────

export type StatementLine = {
  date: string
  number: string
  patient: string | null
  total: number
  paid: number
  balance: number
}

// A dated credit ledger line ("Credit — {reason}"). It reduces the running
// account balance. `number` carries the linked invoice number when the credit
// is invoice-scoped, else null (clinic-level credit).
export type StatementCreditLine = {
  date: string
  reason: string
  number: string | null
  amount: number
}

export type Statement = {
  lines: StatementLine[]
  credits: StatementCreditLine[]
  totalBilled: number
  totalPaid: number
  // Sum of all active account credits (remake / return / goodwill).
  totalCredits: number
  // Closing account balance = totalBilled − totalPaid − totalCredits.
  balance: number
  aging: ArAging
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Build an open-item statement.
 *
 * - Voided and draft (not-yet-issued) invoices are excluded entirely — a
 *   statement of account shows issued billing activity only.
 * - Per-invoice `paid` is the sum of all matching payment rows.
 * - Only invoices with `balance > 0.005` appear in the open-item table,
 *   sorted by `invoice_date` ascending.
 * - `totalBilled` / `totalPaid` are across ALL non-voided invoices.
 * - Aging buckets each open line's BALANCE (not total) by days past `due_date`
 *   using the same boundaries as `arAging` in `invoice-status.ts`.
 *   Missing `due_date` → current bucket.
 * - Credits (remake / return / goodwill) are a non-payment reduction of the
 *   clinic's account. They are NOT folded into the open-item lines or the
 *   payment-based aging buckets; instead they surface as their own dated ledger
 *   lines (sorted by `credit_date`) and net the closing `balance` down via
 *   `totalCredits`. A credit may be clinic-level (no `invoice_id`) or linked to
 *   a specific invoice (its number is carried through for display).
 *
 * @param invoices  Non-mutated; voided rows are skipped internally.
 * @param payments  All payment rows for the clinic's invoices.
 * @param credits   Active account credits for the clinic (optional).
 * @param today     Local `yyyy-MM-dd` string (from `todayISODate()`).
 */
export function buildStatement(
  invoices: StatementInvoiceRow[],
  payments: StatementPaymentRow[],
  credits: StatementCreditRow[],
  today: string,
): Statement {
  // Sum payments per invoice
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount))
  }

  // Map invoice id → number so an invoice-linked credit can display its number.
  const numberByInvoice = new Map<string, string>()
  for (const inv of invoices) numberByInvoice.set(inv.id, inv.invoice_number)

  let totalBilled = 0
  let totalPaid = 0
  const lines: StatementLine[] = []
  const aging: ArAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }

  for (const inv of invoices) {
    // A statement shows ISSUED activity only — skip voided and not-yet-issued drafts.
    if (inv.voided_at != null || inv.status === 'draft') continue

    const total = Number(inv.total)
    const paid = paidByInvoice.get(inv.id) ?? 0
    const balance = total - paid

    totalBilled += total
    totalPaid += paid

    if (balance <= 0.005) continue

    lines.push({
      date: inv.invoice_date,
      number: inv.invoice_number,
      patient: inv.patient,
      total,
      paid,
      balance,
    })

    // Bucket this line's balance into aging
    aging.total += balance
    if (inv.due_date == null || inv.due_date === '') {
      aging.current += balance
    } else {
      const days = differenceInCalendarDays(new Date(today), new Date(inv.due_date))
      if (days <= 0) aging.current += balance
      else if (days <= 30) aging.d1_30 += balance
      else if (days <= 60) aging.d31_60 += balance
      else if (days <= 90) aging.d61_90 += balance
      else aging.d90plus += balance
    }
  }

  // Sort open lines by invoice_date ascending
  lines.sort((a, b) => a.date.localeCompare(b.date))

  // Build credit ledger lines (dated, oldest-first). Each reduces the closing
  // balance. An invoice-linked credit carries its invoice number for display.
  let totalCredits = 0
  const creditLines: StatementCreditLine[] = credits.map((c) => {
    const amount = Number(c.amount)
    totalCredits += amount
    return {
      date: c.credit_date,
      reason: c.reason,
      number: c.invoice_id ? numberByInvoice.get(c.invoice_id) ?? null : null,
      amount,
    }
  })
  creditLines.sort((a, b) => a.date.localeCompare(b.date))

  return {
    lines,
    credits: creditLines,
    totalBilled,
    totalPaid,
    totalCredits,
    // Closing account balance nets out credits — they are an explicit, legible
    // reduction, not folded into the payment-based open-item totals or aging.
    balance: totalBilled - totalPaid - totalCredits,
    aging,
  }
}
