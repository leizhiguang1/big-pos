import { describe, it, expect } from 'vitest'
import type { Invoice } from './database.types'
import { isVoided, countsAsRevenue, isOutstanding, isOverdue, nextStatusAfterPayment, summarizeCustomerInvoices, arAging } from './invoice-status'

const inv = (status: string, voided_at: string | null = null): Pick<Invoice, 'status' | 'voided_at'> =>
  ({ status, voided_at })

const sumInv = (status: string, total: number, voided_at: string | null = null): Pick<Invoice, 'status' | 'total' | 'voided_at'> =>
  ({ status, total, voided_at })

const dueInv = (status: string, due_date: string | null, voided_at: string | null = null): Pick<Invoice, 'status' | 'due_date' | 'voided_at'> =>
  ({ status, due_date, voided_at })

describe('isVoided', () => {
  it('is false when voided_at is null', () => {
    expect(isVoided(inv('paid', null))).toBe(false)
  })
  it('is true when voided_at is set', () => {
    expect(isVoided(inv('paid', '2026-06-03T00:00:00Z'))).toBe(true)
  })
})

describe('countsAsRevenue', () => {
  it('counts a paid, non-voided invoice', () => {
    expect(countsAsRevenue(inv('paid'))).toBe(true)
  })
  it('does NOT count a paid invoice that is voided', () => {
    expect(countsAsRevenue(inv('paid', '2026-06-03T00:00:00Z'))).toBe(false)
  })
  it('does NOT count a non-paid invoice', () => {
    expect(countsAsRevenue(inv('sent'))).toBe(false)
  })
})

describe('isOutstanding', () => {
  it.each(['sent', 'partial', 'overdue'])('counts %s as outstanding', (s) => {
    expect(isOutstanding(inv(s))).toBe(true)
  })
  it('excludes a voided outstanding invoice', () => {
    expect(isOutstanding(inv('sent', '2026-06-03T00:00:00Z'))).toBe(false)
  })
  it('excludes draft and paid', () => {
    expect(isOutstanding(inv('draft'))).toBe(false)
    expect(isOutstanding(inv('paid'))).toBe(false)
  })
})

describe('nextStatusAfterPayment', () => {
  it('becomes paid when recorded payments cover the total', () => {
    expect(nextStatusAfterPayment('sent', 100, 100)).toBe('paid')
    expect(nextStatusAfterPayment('partial', 120, 100)).toBe('paid')
  })
  it('becomes partial when payments fall short', () => {
    expect(nextStatusAfterPayment('sent', 40, 100)).toBe('partial')
    expect(nextStatusAfterPayment('overdue', 0, 100)).toBe('partial')
  })
  it('never downgrades an already-paid invoice, even if recorded payments are short', () => {
    // e.g. invoice was settled via "Mark Paid" with no payment rows, then a
    // partial bank reference is logged after the fact — it must stay paid.
    expect(nextStatusAfterPayment('paid', 0, 100)).toBe('paid')
    expect(nextStatusAfterPayment('paid', 30, 100)).toBe('paid')
    expect(nextStatusAfterPayment('paid', 100, 100)).toBe('paid')
  })
})

describe('isOverdue', () => {
  const TODAY = '2026-06-10'
  it('is true when an outstanding invoice is past its due date', () => {
    expect(isOverdue(dueInv('sent', '2026-06-09'), TODAY)).toBe(true)
    expect(isOverdue(dueInv('partial', '2026-01-01'), TODAY)).toBe(true)
  })
  it('is false when due today or in the future', () => {
    expect(isOverdue(dueInv('sent', '2026-06-10'), TODAY)).toBe(false)
    expect(isOverdue(dueInv('sent', '2026-12-31'), TODAY)).toBe(false)
  })
  it('is false for paid/draft even when past due', () => {
    expect(isOverdue(dueInv('paid', '2026-06-09'), TODAY)).toBe(false)
    expect(isOverdue(dueInv('draft', '2026-06-09'), TODAY)).toBe(false)
  })
  it('is false for a voided invoice past its due date', () => {
    expect(isOverdue(dueInv('sent', '2026-06-09', '2026-06-05T00:00:00Z'), TODAY)).toBe(false)
  })
  it('is false when no due date is set', () => {
    expect(isOverdue(dueInv('sent', null), TODAY)).toBe(false)
    expect(isOverdue(dueInv('sent', ''), TODAY)).toBe(false)
  })
})

describe('summarizeCustomerInvoices', () => {
  it('sums billed across all non-voided invoices', () => {
    const r = summarizeCustomerInvoices([sumInv('draft', 100), sumInv('paid', 50), sumInv('sent', 25)])
    expect(r.totalBilled).toBe(175)
  })
  it('counts only outstanding invoices toward outstanding', () => {
    const r = summarizeCustomerInvoices([sumInv('sent', 100), sumInv('partial', 40), sumInv('paid', 999), sumInv('draft', 10)])
    expect(r.totalOutstanding).toBe(140)
  })
  it('excludes voided invoices from both totals', () => {
    const r = summarizeCustomerInvoices([sumInv('paid', 100), sumInv('sent', 50, '2026-06-05T00:00:00Z')])
    expect(r.totalBilled).toBe(100)
    expect(r.totalOutstanding).toBe(0)
  })
  it('returns zeros for no invoices', () => {
    expect(summarizeCustomerInvoices([])).toEqual({ totalBilled: 0, totalOutstanding: 0 })
  })
})

describe('arAging', () => {
  const agingInv = (total: number, due_date: string, status = 'sent', voided_at: string | null = null) =>
    ({ status, voided_at, total, due_date } as Pick<Invoice, 'status' | 'voided_at' | 'total' | 'due_date'>)

  it('buckets outstanding invoices by days past the due date', () => {
    const today = '2026-06-23'
    const a = arAging(
      [
        agingInv(100, '2026-06-30'), // not yet due -> current
        agingInv(200, '2026-06-10'), // 13 days -> 1-30
        agingInv(300, '2026-05-10'), // 44 days -> 31-60
        agingInv(350, '2026-04-10'), // 74 days -> 61-90
        agingInv(400, '2026-03-01'), // >90 -> 90+
      ],
      today,
    )
    expect(a.current).toBe(100)
    expect(a.d1_30).toBe(200)
    expect(a.d31_60).toBe(300)
    expect(a.d61_90).toBe(350)
    expect(a.d90plus).toBe(400)
    expect(a.total).toBe(1350)
  })

  it('excludes paid and voided invoices', () => {
    const a = arAging(
      [
        agingInv(500, '2026-01-01', 'paid'),
        agingInv(600, '2026-01-01', 'sent', '2026-02-01'),
      ],
      '2026-06-23',
    )
    expect(a.total).toBe(0)
  })
})
