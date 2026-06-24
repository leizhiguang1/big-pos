import { describe, expect, it } from 'vitest'
import {
  invoiceSnapshotFromSettings,
  paymentDetailsForInvoice,
  validateBillingSettings,
  type InvoicePaymentSnapshot,
} from '@/lib/billing-settings'
import type { BillingSettings } from '@/lib/config'

const current: BillingSettings = {
  bankName: 'New Bank',
  accountName: 'New Account Sdn Bhd',
  accountNumber: '999',
  paymentNote: 'Use current invoice number',
  invoiceNotes: ['Current note'],
  paymentTermsDays: 45,
}

const legacySnapshot: InvoicePaymentSnapshot = {
  payment_bank_name: 'Public Bank',
  payment_account_name: 'Chi Dental Lab Sdn Bhd',
  payment_account_number: '3249402703',
  payment_note: 'Please use invoice number as payment reference',
  invoice_notes: ['Goods sold are neither returnable nor refundable.'],
}

describe('billing settings invoice snapshots', () => {
  it('uses stored invoice payment details when a snapshot exists', () => {
    // Payment terms aren't snapshotted per invoice, so the term reflects the
    // current global setting even for a snapshotted (legacy) invoice.
    expect(paymentDetailsForInvoice(legacySnapshot, current)).toEqual({
      bankName: 'Public Bank',
      accountName: 'Chi Dental Lab Sdn Bhd',
      accountNumber: '3249402703',
      paymentNote: 'Please use invoice number as payment reference',
      invoiceNotes: ['Goods sold are neither returnable nor refundable.'],
      paymentTermsDays: 45,
    })
  })

  it('uses current billing settings when an invoice has no snapshot', () => {
    expect(paymentDetailsForInvoice({
      payment_bank_name: null,
      payment_account_name: null,
      payment_account_number: null,
      payment_note: null,
      invoice_notes: null,
    }, current)).toEqual(current)
  })

  it('normalizes settings before saving a snapshot', () => {
    expect(invoiceSnapshotFromSettings({
      bankName: ' Public Bank ',
      accountName: ' Chi Dental Lab Sdn Bhd ',
      accountNumber: ' 3249402703 ',
      paymentNote: ' Please use invoice number ',
      invoiceNotes: [' Note one ', '', ' Note two '],
      paymentTermsDays: 30,
    })).toEqual({
      payment_bank_name: 'Public Bank',
      payment_account_name: 'Chi Dental Lab Sdn Bhd',
      payment_account_number: '3249402703',
      payment_note: 'Please use invoice number',
      invoice_notes: ['Note one', 'Note two'],
    })
  })

  it('requires the bank account fields', () => {
    expect(validateBillingSettings({ ...current, bankName: ' ' })).toBe('Bank name is required.')
    expect(validateBillingSettings({ ...current, accountName: ' ' })).toBe('Account name is required.')
    expect(validateBillingSettings({ ...current, accountNumber: ' ' })).toBe('Account number is required.')
  })

  it('requires payment terms of at least 1 day', () => {
    expect(validateBillingSettings({ ...current, paymentTermsDays: 0 })).toBe('Payment terms must be at least 1 day.')
    expect(validateBillingSettings({ ...current, paymentTermsDays: 30 })).toBeNull()
  })
})
