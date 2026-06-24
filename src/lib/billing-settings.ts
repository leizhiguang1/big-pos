import { DEFAULT_BILLING_SETTINGS, type BillingSettings } from '@/lib/config'

type BillingSettingsRow = {
  bank_name: string
  account_name: string
  account_number: string
  payment_note: string
  invoice_notes: string[] | null
  payment_terms_days: number | null
}

export type BillingSettingsInput = BillingSettings

export type InvoicePaymentSnapshot = {
  payment_bank_name: string | null
  payment_account_name: string | null
  payment_account_number: string | null
  payment_note: string | null
  invoice_notes: string[] | null
}

export function billingSettingsFromRow(row: BillingSettingsRow | null | undefined): BillingSettings {
  if (!row) return DEFAULT_BILLING_SETTINGS
  return {
    bankName: row.bank_name || DEFAULT_BILLING_SETTINGS.bankName,
    accountName: row.account_name || DEFAULT_BILLING_SETTINGS.accountName,
    accountNumber: row.account_number || DEFAULT_BILLING_SETTINGS.accountNumber,
    paymentNote: row.payment_note ?? DEFAULT_BILLING_SETTINGS.paymentNote,
    invoiceNotes: row.invoice_notes ?? DEFAULT_BILLING_SETTINGS.invoiceNotes,
    paymentTermsDays: row.payment_terms_days ?? DEFAULT_BILLING_SETTINGS.paymentTermsDays,
  }
}

export function normalizeBillingSettings(input: BillingSettingsInput): BillingSettings {
  return {
    bankName: input.bankName.trim(),
    accountName: input.accountName.trim(),
    accountNumber: input.accountNumber.trim(),
    paymentNote: input.paymentNote.trim(),
    invoiceNotes: input.invoiceNotes.map(note => note.trim()).filter(Boolean),
    // Clamp to a whole number ≥ 1 to match the DB CHECK.
    paymentTermsDays: Math.max(1, Math.round(input.paymentTermsDays || DEFAULT_BILLING_SETTINGS.paymentTermsDays)),
  }
}

export function validateBillingSettings(input: BillingSettingsInput): string | null {
  const normalized = normalizeBillingSettings(input)
  if (!normalized.bankName) return 'Bank name is required.'
  if (!normalized.accountName) return 'Account name is required.'
  if (!normalized.accountNumber) return 'Account number is required.'
  if (!Number.isFinite(input.paymentTermsDays) || input.paymentTermsDays < 1) {
    return 'Payment terms must be at least 1 day.'
  }
  return null
}

export function invoiceSnapshotFromSettings(settings: BillingSettings) {
  const normalized = normalizeBillingSettings(settings)
  return {
    payment_bank_name: normalized.bankName,
    payment_account_name: normalized.accountName,
    payment_account_number: normalized.accountNumber,
    payment_note: normalized.paymentNote,
    invoice_notes: normalized.invoiceNotes,
  }
}

export function hasInvoicePaymentSnapshot(invoice: InvoicePaymentSnapshot): boolean {
  return Boolean(
    invoice.payment_bank_name
      && invoice.payment_account_name
      && invoice.payment_account_number
      && invoice.payment_note !== null
      && invoice.invoice_notes !== null,
  )
}

export function paymentDetailsForInvoice(
  invoice: InvoicePaymentSnapshot,
  currentSettings: BillingSettings,
): BillingSettings {
  if (!hasInvoicePaymentSnapshot(invoice)) return currentSettings
  return {
    bankName: invoice.payment_bank_name!,
    accountName: invoice.payment_account_name!,
    accountNumber: invoice.payment_account_number!,
    paymentNote: invoice.payment_note ?? '',
    invoiceNotes: invoice.invoice_notes ?? [],
    // Payment terms aren't part of the per-invoice snapshot (only bank/notes are);
    // the printed "Payment Terms" line reflects the current global setting.
    paymentTermsDays: currentSettings.paymentTermsDays,
  }
}
