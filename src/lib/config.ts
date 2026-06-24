export const COMPANY = {
  name: 'Chi Dental Lab',
  address: 'No179-1 Jalan SS 2/24, SS 2, 47300 Petaling Jaya, Selangor',
  phone: '01155627949',
  email: 'chidentallab@gmail.com',
}

// Default SST tax rate (%) prefilled on a new invoice (Wave 5). Ships at 0 — the
// tax line stays hidden until the accountant confirms the service-tax rate +
// threshold, at which point only this constant changes (and existing invoices
// keep their saved per-invoice rate).
export const DEFAULT_TAX_RATE = 0

export const BANK = {
  bankName: 'Public Bank',
  accountName: 'Chi Dental Lab Sdn Bhd',
  accountNumber: '3249402703',
  paymentNote: 'Please use invoice number as payment reference',
}

export const BILLING_SETTINGS_ID = 'default'

// The lab's standard payment terms (days). The invoice no longer captures a due
// date in the UI; instead every invoice's due_date is derived as invoice date +
// this (the column is NOT NULL and feeds A/R aging), and the printed invoice
// shows this as the "Payment Terms" line. A future per-clinic/global setting can
// replace this constant without reintroducing the due-date field.
export const DEFAULT_PAYMENT_TERMS_DAYS = 30

// Standing notes printed at the foot of every invoice (right of the bank
// details). Numbered in render order.
export const INVOICE_NOTES = [
  'Goods sold are neither returnable nor refundable.',
]

export type BillingSettings = typeof BANK & {
  invoiceNotes: string[]
  // The lab's standard payment terms (days). Configurable in Settings → Billing;
  // derives every NEW invoice's due_date (invoice_date + this).
  paymentTermsDays: number
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  ...BANK,
  invoiceNotes: INVOICE_NOTES,
  paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS,
}
