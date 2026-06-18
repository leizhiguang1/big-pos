import { describe, it, expect } from 'vitest'
import { isOverdue, nextStatusAfterPayment, canTransition, countsAsRevenue } from './billing'

type InvoiceFields = { status: string; due_date: string; voided_at: string | null }
const inv = (o: Partial<InvoiceFields> = {}) => ({ status: 'sent', due_date: '2026-01-01', voided_at: null, ...o })

describe('billing', () => {
  it('paid invoice never downgrades on payment', () =>
    expect(nextStatusAfterPayment('paid', 0, 100)).toBe('paid'))
  it('full payment -> paid', () =>
    expect(nextStatusAfterPayment('sent', 100, 100)).toBe('paid'))
  it('partial payment -> partial', () =>
    expect(nextStatusAfterPayment('sent', 40, 100)).toBe('partial'))
  it('overdue is derived from due_date', () => {
    expect(isOverdue(inv({ status: 'sent', due_date: '2026-01-01' }), '2026-06-18')).toBe(true)
    expect(isOverdue(inv({ status: 'paid', due_date: '2026-01-01' }), '2026-06-18')).toBe(false)
    expect(isOverdue(inv({ voided_at: '2026-02-02' }), '2026-06-18')).toBe(false)
  })
  it('voided never counts as revenue', () =>
    expect(countsAsRevenue(inv({ status: 'paid', voided_at: '2026-02-02' }))).toBe(false))
  it('allows draft->sent, forbids paid->draft', () => {
    expect(canTransition('draft', 'sent')).toBe(true)
    expect(canTransition('paid', 'draft')).toBe(false)
  })
})
