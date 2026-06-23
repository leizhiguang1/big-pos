import { differenceInCalendarDays } from 'date-fns'
import type { Invoice } from '@/lib/database.types'

type VoidFields = Pick<Invoice, 'voided_at'>
type CountFields = Pick<Invoice, 'voided_at' | 'status'>
type DueFields = Pick<Invoice, 'voided_at' | 'status' | 'due_date'>

const OUTSTANDING_STATUSES = ['sent', 'partial', 'overdue'] as const

/** An invoice is voided (soft-deleted/cancelled) when voided_at is set. */
export const isVoided = (inv: VoidFields): boolean => inv.voided_at != null

/** Counts toward recognized revenue: paid and not voided. */
export const countsAsRevenue = (inv: CountFields): boolean =>
  !isVoided(inv) && inv.status === 'paid'

/** Owed money: sent/partial/overdue and not voided. */
export const isOutstanding = (inv: CountFields): boolean =>
  !isVoided(inv) && (OUTSTANDING_STATUSES as readonly string[]).includes(inv.status)

/**
 * The status to write after recording a payment. `paidSum` is the total of all
 * recorded payment rows; `total` is the invoice total. A fully-covered invoice
 * becomes 'paid', otherwise 'partial'. An invoice already settled (status
 * 'paid' — e.g. via the "Mark Paid" shortcut, which records no payment rows)
 * is never downgraded: logging a later bank reference must not flip it back to
 * partial.
 */
export const nextStatusAfterPayment = (
  current: string,
  paidSum: number,
  total: number,
): 'paid' | 'partial' =>
  current === 'paid' || paidSum >= total ? 'paid' : 'partial'

/**
 * Overdue is derived, not stored: an outstanding invoice whose due date has
 * passed. `today` is a local `yyyy-MM-dd` string (see `todayISODate`); string
 * comparison is valid for that fixed-width format.
 */
export const isOverdue = (inv: DueFields, today: string): boolean =>
  isOutstanding(inv) && inv.due_date != null && inv.due_date !== '' && inv.due_date < today

type SummaryFields = Pick<Invoice, 'voided_at' | 'status' | 'total'>

/**
 * Customer billing rollup. `totalBilled` sums every non-voided invoice total;
 * `totalOutstanding` sums totals on outstanding (sent/partial/overdue, non-voided)
 * invoices. Mirrors the derivation `customers/[id]/page.tsx` did in-render.
 */
export const summarizeCustomerInvoices = (
  invoices: SummaryFields[],
): { totalBilled: number; totalOutstanding: number } => ({
  totalBilled: invoices.filter((i) => !isVoided(i)).reduce((s, i) => s + Number(i.total), 0),
  totalOutstanding: invoices.filter((i) => isOutstanding(i)).reduce((s, i) => s + Number(i.total), 0),
})

type AgingFields = Pick<Invoice, 'voided_at' | 'status' | 'total' | 'due_date'>

export interface ArAging {
  current: number // not yet past due
  d1_30: number
  d31_60: number
  d61_90: number
  d90plus: number
  total: number
}

/**
 * A/R aging of a clinic's OUTSTANDING invoices, bucketed by days past the due
 * date. Mirrors `summarizeCustomerInvoices`: it uses the full invoice total
 * (not net of partial payments) so the buckets sum to `totalOutstanding`.
 * `today` is a local `yyyy-MM-dd` string (see `todayISODate`).
 */
export const arAging = (invoices: AgingFields[], today: string): ArAging => {
  const out: ArAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }
  for (const inv of invoices) {
    if (!isOutstanding(inv)) continue
    const amt = Number(inv.total)
    out.total += amt
    if (inv.due_date == null || inv.due_date === '') {
      out.current += amt
      continue
    }
    const days = differenceInCalendarDays(new Date(today), new Date(inv.due_date))
    if (days <= 0) out.current += amt
    else if (days <= 30) out.d1_30 += amt
    else if (days <= 60) out.d31_60 += amt
    else if (days <= 90) out.d61_90 += amt
    else out.d90plus += amt
  }
  return out
}
