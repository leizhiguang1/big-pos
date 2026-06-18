import { describe, it, expect } from 'vitest'
import type { Invoice } from './database.types'
import { canEditInvoice } from './invoice-permissions'

const inv = (status: string, voided_at: string | null = null): Pick<Invoice, 'status' | 'voided_at'> => ({ status, voided_at })
const allow = () => true
const deny = () => false
const only = (...perms: string[]) => (p: string) => perms.includes(p)

describe('canEditInvoice', () => {
  it('locks a voided invoice for everyone', () => {
    expect(canEditInvoice(inv('draft', '2026-06-03T00:00:00Z'), allow)).toBe(false)
  })
  it('lets a holder of invoices.edit edit a draft', () => {
    expect(canEditInvoice(inv('draft'), only('invoices.edit'))).toBe(true)
  })
  it('blocks a draft edit without invoices.edit', () => {
    expect(canEditInvoice(inv('draft'), deny)).toBe(false)
  })
  it('requires invoices.manage for a sent invoice', () => {
    expect(canEditInvoice(inv('sent'), only('invoices.manage'))).toBe(true)
    expect(canEditInvoice(inv('sent'), only('invoices.edit'))).toBe(false)
  })
})
