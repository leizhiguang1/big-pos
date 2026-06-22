import { describe, it, expect } from 'vitest'
import { paymentInputSchema, invoiceInputSchema, customerInputSchema, productInputSchema, normalizeUnit } from './schemas'

const product = (over: Record<string, unknown> = {}) => ({
  name: 'Crown', description: null, unit_price: 100, unit: 'per unit',
  min_unit_price: null, max_unit_price: null, ...over,
})
describe('schemas', () => {
  it('rejects non-positive payment', () =>
    expect(paymentInputSchema.safeParse({ amount: 0 }).success).toBe(false))
  it('requires at least one line item', () =>
    expect(invoiceInputSchema.safeParse({ customer_id: 'x', due_date: '2026-01-01', items: [] }).success).toBe(false))

  it('requires a clinic name on a customer', () =>
    expect(customerInputSchema.safeParse({ clinic_name: '' }).success).toBe(false))
  it('accepts a minimal customer (clinic name only)', () =>
    expect(customerInputSchema.safeParse({ clinic_name: 'Klinik Gigi' }).success).toBe(true))
  it('accepts an empty email but rejects a malformed one', () => {
    expect(customerInputSchema.safeParse({ clinic_name: 'A', email: '' }).success).toBe(true)
    expect(customerInputSchema.safeParse({ clinic_name: 'A', email: 'not-an-email' }).success).toBe(false)
  })

  it('accepts a single-price product', () =>
    expect(productInputSchema.safeParse(product()).success).toBe(true))
  it('accepts a valid price band (min <= max)', () =>
    expect(productInputSchema.safeParse(product({ min_unit_price: 50, max_unit_price: 150 })).success).toBe(true))
  it('rejects an inverted price band (min > max)', () =>
    expect(productInputSchema.safeParse(product({ min_unit_price: 150, max_unit_price: 50 })).success).toBe(false))
  it('requires a product name and unit', () => {
    expect(productInputSchema.safeParse(product({ name: '' })).success).toBe(false)
    expect(productInputSchema.safeParse(product({ unit: '' })).success).toBe(false)
  })

  it('normalizeUnit strips a leading "per " and lowercases', () => {
    expect(normalizeUnit('per unit')).toBe('unit')
    expect(normalizeUnit('Per Tooth')).toBe('tooth')
    expect(normalizeUnit('  per   arch ')).toBe('arch')
    expect(normalizeUnit('set')).toBe('set')
    expect(normalizeUnit('PER SET')).toBe('set')
  })
  it('normalizeUnit returns empty for blank or bare "per " input', () => {
    expect(normalizeUnit('   ')).toBe('')
    expect(normalizeUnit('per ')).toBe('')
  })
  it('productInputSchema normalizes the unit on parse', () => {
    const parsed = productInputSchema.safeParse(product({ unit: 'Per Tooth' }))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.unit).toBe('tooth')
  })
  it('productInputSchema rejects a unit that normalizes to empty', () => {
    expect(productInputSchema.safeParse(product({ unit: 'per ' })).success).toBe(false)
    expect(productInputSchema.safeParse(product({ unit: '' })).success).toBe(false)
  })
})
