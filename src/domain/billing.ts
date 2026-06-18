export type BillingStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue'

export const OUTSTANDING_STATUSES: BillingStatus[] = ['sent', 'partial', 'overdue']

type InvoiceLike = { status: string; due_date: string; voided_at: string | null }

export const isVoided = (inv: Pick<InvoiceLike, 'voided_at'>) => inv.voided_at != null
export const isOutstanding = (inv: InvoiceLike) =>
  !isVoided(inv) && OUTSTANDING_STATUSES.includes(inv.status as BillingStatus)
export const countsAsRevenue = (inv: InvoiceLike) => !isVoided(inv) && inv.status === 'paid'
export const isOverdue = (inv: InvoiceLike, todayISO: string) =>
  isOutstanding(inv) && inv.due_date < todayISO

// allowed MANUAL transitions (payment-driven changes go through nextStatusAfterPayment)
const TRANSITIONS: Record<BillingStatus, BillingStatus[]> = {
  draft: ['sent'],
  sent: ['partial', 'paid'],
  partial: ['paid'],
  paid: [],
  overdue: ['partial', 'paid'],
}
export const canTransition = (from: BillingStatus, to: BillingStatus) =>
  TRANSITIONS[from]?.includes(to) ?? false

export const nextStatusAfterPayment = (
  current: BillingStatus,
  paidSum: number,
  total: number,
): BillingStatus => (current === 'paid' || paidSum >= total ? 'paid' : 'partial')
