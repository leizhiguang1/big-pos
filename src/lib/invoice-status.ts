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
