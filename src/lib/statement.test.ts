import { describe, it, expect } from 'vitest'
import { buildStatement } from './statement'
import type { StatementInvoiceRow, StatementPaymentRow, StatementCreditRow } from './statement'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = '2026-06-23'

function makeInv(overrides: Partial<StatementInvoiceRow> & { id: string }): StatementInvoiceRow {
  return {
    invoice_number: `INV-${overrides.id}`,
    invoice_date: '2026-01-01',
    due_date: '2026-01-31',
    patient: null,
    total: 100,
    status: 'sent',
    voided_at: null,
    ...overrides,
  }
}

function makePay(invoice_id: string, amount: number): StatementPaymentRow {
  return { invoice_id, amount }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildStatement', () => {
  it('returns empty statement when no invoices', () => {
    const stmt = buildStatement([], [], [], TODAY)
    expect(stmt.lines).toHaveLength(0)
    expect(stmt.totalBilled).toBe(0)
    expect(stmt.totalPaid).toBe(0)
    expect(stmt.balance).toBe(0)
    expect(stmt.aging.total).toBe(0)
  })

  it('excludes voided invoices from lines, totals, and aging', () => {
    const invoices = [
      makeInv({ id: 'a', total: 200, voided_at: '2026-06-01' }),
      makeInv({ id: 'b', total: 100 }),
    ]
    const stmt = buildStatement(invoices, [], [], TODAY)
    expect(stmt.lines).toHaveLength(1)
    expect(stmt.lines[0].number).toBe('INV-b')
    expect(stmt.totalBilled).toBe(100)
    expect(stmt.totalPaid).toBe(0)
    expect(stmt.balance).toBe(100)
  })

  it('excludes fully-paid invoices from open lines but includes totals', () => {
    const invoices = [
      makeInv({ id: 'a', total: 100 }),
      makeInv({ id: 'b', total: 200 }),
    ]
    const payments = [
      makePay('a', 100), // fully paid
    ]
    const stmt = buildStatement(invoices, payments, [], TODAY)
    expect(stmt.lines).toHaveLength(1)
    expect(stmt.lines[0].number).toBe('INV-b')
    expect(stmt.totalBilled).toBe(300)
    expect(stmt.totalPaid).toBe(100)
    expect(stmt.balance).toBe(200)
  })

  it('sums multiple payments per invoice', () => {
    const invoices = [makeInv({ id: 'a', total: 300 })]
    const payments = [makePay('a', 100), makePay('a', 50)]
    const stmt = buildStatement(invoices, payments, [], TODAY)
    expect(stmt.lines[0].paid).toBe(150)
    expect(stmt.lines[0].balance).toBe(150)
  })

  it('excludes invoice with balance <= 0.005 (rounding threshold)', () => {
    const invoices = [makeInv({ id: 'a', total: 100 })]
    const payments = [makePay('a', 99.996)] // balance = 0.004
    const stmt = buildStatement(invoices, payments, [], TODAY)
    expect(stmt.lines).toHaveLength(0)
    expect(stmt.totalBilled).toBe(100)
    expect(stmt.balance).toBeCloseTo(0.004)
  })

  it('sorts open lines by invoice_date ascending', () => {
    const invoices = [
      makeInv({ id: 'c', invoice_date: '2026-03-01' }),
      makeInv({ id: 'a', invoice_date: '2026-01-01' }),
      makeInv({ id: 'b', invoice_date: '2026-02-01' }),
    ]
    const stmt = buildStatement(invoices, [], [], TODAY)
    expect(stmt.lines.map(l => l.number)).toEqual(['INV-a', 'INV-b', 'INV-c'])
  })

  describe('aging buckets', () => {
    // TODAY = '2026-06-23'
    // due_date diff from today determines bucket:
    //   <= 0 days overdue → current
    //   1–30  → d1_30
    //   31–60 → d31_60
    //   61–90 → d61_90
    //   90+   → d90plus

    it('buckets not-yet-due balance as current', () => {
      const invoices = [makeInv({ id: 'a', total: 100, due_date: '2026-07-01' })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.current).toBe(100)
      expect(stmt.aging.total).toBe(100)
    })

    it('buckets due today as current', () => {
      const invoices = [makeInv({ id: 'a', total: 100, due_date: TODAY })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.current).toBe(100)
    })

    it('buckets 15 days overdue into d1_30', () => {
      // due 2026-06-08 → 15 days overdue
      const invoices = [makeInv({ id: 'a', total: 100, due_date: '2026-06-08' })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.d1_30).toBe(100)
    })

    it('buckets 45 days overdue into d31_60', () => {
      // due 2026-05-09 → 45 days overdue
      const invoices = [makeInv({ id: 'a', total: 100, due_date: '2026-05-09' })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.d31_60).toBe(100)
    })

    it('buckets 75 days overdue into d61_90', () => {
      // due 2026-04-09 → 75 days overdue
      const invoices = [makeInv({ id: 'a', total: 100, due_date: '2026-04-09' })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.d61_90).toBe(100)
    })

    it('buckets 100 days overdue into d90plus', () => {
      // due 2026-03-15 → 100 days overdue
      const invoices = [makeInv({ id: 'a', total: 100, due_date: '2026-03-15' })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.d90plus).toBe(100)
    })

    it('buckets missing due_date as current', () => {
      const invoices = [makeInv({ id: 'a', total: 100, due_date: null })]
      const stmt = buildStatement(invoices, [], [], TODAY)
      expect(stmt.aging.current).toBe(100)
    })

    it('aging total equals statement balance (open balances only)', () => {
      const invoices = [
        makeInv({ id: 'a', total: 200, due_date: '2026-05-01' }), // overdue
        makeInv({ id: 'b', total: 100, due_date: '2026-07-01' }), // current
        makeInv({ id: 'c', total: 50, voided_at: '2026-01-01' }), // voided — excluded
      ]
      const payments = [makePay('a', 50)] // partial
      const stmt = buildStatement(invoices, payments, [], TODAY)
      // open balances: a=150, b=100
      expect(stmt.aging.total).toBe(250)
      expect(stmt.aging.total).toBe(stmt.balance - 0) // balance = totalBilled(300) - totalPaid(50) = 250
    })

    it('buckets BALANCE (not total) into aging for partially-paid invoice', () => {
      const invoices = [makeInv({ id: 'a', total: 200, due_date: '2026-06-08' })] // 15 days overdue
      const payments = [makePay('a', 60)]
      const stmt = buildStatement(invoices, payments, [], TODAY)
      expect(stmt.aging.d1_30).toBe(140) // balance, not 200
      expect(stmt.aging.total).toBe(140)
    })
  })
})

describe('buildStatement — draft exclusion', () => {
  it('excludes draft (not-yet-issued) invoices from lines, totals, and aging', () => {
    const stmt = buildStatement(
      [makeInv({ id: 'd', total: 800, status: 'draft' }), makeInv({ id: 's', total: 200, status: 'sent' })],
      [],
      [],
      TODAY,
    )
    expect(stmt.lines).toHaveLength(1)
    expect(stmt.lines[0].number).toBe('INV-s')
    expect(stmt.totalBilled).toBe(200)
    expect(stmt.balance).toBe(200)
    expect(stmt.aging.total).toBe(200)
  })
})

describe('buildStatement — credits', () => {
  function makeCredit(overrides: Partial<StatementCreditRow> = {}): StatementCreditRow {
    return { credit_date: '2026-02-01', amount: 50, reason: 'goodwill', invoice_id: null, ...overrides }
  }

  it('reduces the closing balance by the sum of active credits', () => {
    const invoices = [makeInv({ id: 'a', total: 300 })]
    const credits = [makeCredit({ amount: 120, reason: 'remake' })]
    const stmt = buildStatement(invoices, [], credits, TODAY)
    expect(stmt.totalBilled).toBe(300)
    expect(stmt.totalPaid).toBe(0)
    expect(stmt.totalCredits).toBe(120)
    // closing balance = billed(300) − paid(0) − credits(120)
    expect(stmt.balance).toBe(180)
  })

  it('credits do NOT enter the payment-based aging buckets', () => {
    // Aging stays payment-based: it buckets the full open balance of the
    // invoice, unaffected by the credit, which lands only in totalCredits.
    const invoices = [makeInv({ id: 'a', total: 200, due_date: '2026-06-08' })] // 15 days overdue
    const credits = [makeCredit({ amount: 80 })]
    const stmt = buildStatement(invoices, [], credits, TODAY)
    expect(stmt.aging.d1_30).toBe(200)
    expect(stmt.aging.total).toBe(200)
    expect(stmt.totalCredits).toBe(80)
    expect(stmt.balance).toBe(120) // 200 − 80
  })

  it('emits dated credit ledger lines sorted by credit_date ascending', () => {
    const invoices = [makeInv({ id: 'a', total: 500 })]
    const credits = [
      makeCredit({ credit_date: '2026-03-15', amount: 30, reason: 'return' }),
      makeCredit({ credit_date: '2026-01-10', amount: 20, reason: 'goodwill' }),
    ]
    const stmt = buildStatement(invoices, [], credits, TODAY)
    expect(stmt.credits.map((c) => c.date)).toEqual(['2026-01-10', '2026-03-15'])
    expect(stmt.credits[0].reason).toBe('goodwill')
    expect(stmt.totalCredits).toBe(50)
  })

  it('carries the invoice number for an invoice-linked credit, null for a clinic-level credit', () => {
    const invoices = [makeInv({ id: 'a', invoice_number: 'INV-2026-001', total: 400 })]
    const credits = [
      makeCredit({ amount: 60, invoice_id: 'a' }), // linked
      makeCredit({ amount: 40, invoice_id: null }), // clinic-level
    ]
    const stmt = buildStatement(invoices, [], credits, TODAY)
    const linked = stmt.credits.find((c) => c.amount === 60)
    const clinic = stmt.credits.find((c) => c.amount === 40)
    expect(linked?.number).toBe('INV-2026-001')
    expect(clinic?.number).toBeNull()
  })

  it('no credits → empty credit lines, zero totalCredits, balance unchanged', () => {
    const invoices = [makeInv({ id: 'a', total: 100 })]
    const stmt = buildStatement(invoices, [], [], TODAY)
    expect(stmt.credits).toHaveLength(0)
    expect(stmt.totalCredits).toBe(0)
    expect(stmt.balance).toBe(100)
  })
})
