import { describe, it, expect } from 'vitest'
import { paymentInputSchema, invoiceInputSchema } from './schemas'
describe('schemas', () => {
  it('rejects non-positive payment', () =>
    expect(paymentInputSchema.safeParse({ amount: 0 }).success).toBe(false))
  it('requires at least one line item', () =>
    expect(invoiceInputSchema.safeParse({ customer_id: 'x', due_date: '2026-01-01', items: [] }).success).toBe(false))
})
