import { describe, it, expect } from 'vitest'
import type { ReportInvoice } from './reports'
import { summarizeReports, aggregateByCustomer, aggregateByProduct } from './reports'

// Minimal invoice factory — only the fields the summary reads.
const ri = (over: Partial<ReportInvoice> = {}): ReportInvoice => ({
  id: 'i1',
  invoice_number: 'INV-1',
  status: 'sent',
  total: 100,
  voided_at: null,
  invoice_date: '2026-06-01',
  due_date: '2026-06-10',
  ...over,
})

const NOW = new Date('2026-06-20T00:00:00Z').getTime()

describe('summarizeReports', () => {
  it('excludes voided invoices from invoiced/customer/product totals', () => {
    const r = summarizeReports([ri({ total: 100 }), ri({ total: 50, voided_at: '2026-06-05T00:00:00Z' })], NOW)
    expect(r.totalInvoiced).toBe(100)
  })

  it('sums collected (paid, non-voided) and outstanding separately', () => {
    const r = summarizeReports(
      [ri({ status: 'paid', total: 200 }), ri({ status: 'sent', total: 80 }), ri({ status: 'partial', total: 20 })],
      NOW,
    )
    expect(r.totalPaidInvoices).toBe(200)
    expect(r.totalOutstanding).toBe(100)
  })

  it('computes aging days for outstanding invoices, newest-overdue first', () => {
    const r = summarizeReports(
      [ri({ due_date: '2026-06-10' }), ri({ due_date: '2026-05-21' })],
      NOW,
    )
    expect(r.outstanding[0].daysOverdue).toBe(30) // 2026-05-21 → 2026-06-20
    expect(r.outstanding[1].daysOverdue).toBe(10)
  })

  it('aggregates revenue by customer (top, descending)', () => {
    const r = summarizeReports(
      [
        ri({ total: 100, customers: { clinic_name: 'A' } }),
        ri({ total: 300, customers: { clinic_name: 'B' } }),
        ri({ total: 50, customers: { clinic_name: 'A' } }),
      ],
      NOW,
    )
    expect(r.byCustomer.map(c => c.name)).toEqual(['B', 'A'])
    expect(r.byCustomer[1]).toMatchObject({ name: 'A', total: 150, count: 2 })
  })

  it('aggregates revenue by product, falling back to line description', () => {
    const r = summarizeReports(
      [ri({ invoice_items: [
        { description: 'Custom job', amount: 40, quantity: 1 },
        { description: 'x', amount: 60, quantity: 2, products: { name: 'Crown' } },
      ] })],
      NOW,
    )
    const names = r.byProduct.map(p => p.name)
    expect(names).toContain('Crown')
    expect(names).toContain('Custom job')
  })
})

describe('aggregation limit', () => {
  const clinics = Array.from({ length: 15 }, (_, i) =>
    ri({ total: i + 1, customers: { clinic_name: `C${i}` } }),
  )
  const products = Array.from({ length: 15 }, (_, i) =>
    ri({ invoice_items: [{ description: `P${i}`, amount: i + 1, quantity: 1 }] }),
  )

  it('aggregateByCustomer defaults to top 10', () => {
    expect(aggregateByCustomer(clinics)).toHaveLength(10)
  })
  it('aggregateByCustomer returns all rows when limit is Infinity', () => {
    expect(aggregateByCustomer(clinics, Infinity)).toHaveLength(15)
  })
  it('aggregateByProduct defaults to top 10', () => {
    expect(aggregateByProduct(products)).toHaveLength(10)
  })
  it('aggregateByProduct returns all rows when limit is Infinity', () => {
    expect(aggregateByProduct(products, Infinity)).toHaveLength(15)
  })
  it('summarizeReports returns full breakdowns, not just top 10', () => {
    const r = summarizeReports(clinics, NOW)
    expect(r.byCustomer).toHaveLength(15)
  })
})
