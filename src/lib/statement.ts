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

// ── Output types ─────────────────────────────────────────────────────────────

export type StatementLine = {
  date: string
  number: string
  patient: string | null
  total: number
  paid: number
  balance: number
}

export type Statement = {
  lines: StatementLine[]
  totalBilled: number
  totalPaid: number
  balance: number
  aging: ArAging
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Build an open-item statement.
 *
 * - Voided invoices are excluded entirely.
 * - Per-invoice `paid` is the sum of all matching payment rows.
 * - Only invoices with `balance > 0.005` appear in the open-item table,
 *   sorted by `invoice_date` ascending.
 * - `totalBilled` / `totalPaid` are across ALL non-voided invoices.
 * - Aging buckets each open line's BALANCE (not total) by days past `due_date`
 *   using the same boundaries as `arAging` in `invoice-status.ts`.
 *   Missing `due_date` → current bucket.
 *
 * @param invoices  Non-mutated; voided rows are skipped internally.
 * @param payments  All payment rows for the clinic's invoices.
 * @param today     Local `yyyy-MM-dd` string (from `todayISODate()`).
 */
export function buildStatement(
  invoices: StatementInvoiceRow[],
  payments: StatementPaymentRow[],
  today: string,
): Statement {
  // Sum payments per invoice
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount))
  }

  let totalBilled = 0
  let totalPaid = 0
  const lines: StatementLine[] = []
  const aging: ArAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }

  for (const inv of invoices) {
    if (inv.voided_at != null) continue

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

  return {
    lines,
    totalBilled,
    totalPaid,
    balance: totalBilled - totalPaid,
    aging,
  }
}
