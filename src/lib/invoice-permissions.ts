import type { InvoiceStatus } from '@/lib/database.types'

/**
 * Whether an invoice's content (header fields, line items, recipient,
 * patient/doctor) may be edited.
 *
 * Rules:
 * - `void` is terminal — locked for everyone.
 * - `draft` is editable by anyone (staff or admin).
 * - Once sent (`sent`/`partial`/`paid`/`overdue`) only an admin may edit.
 *
 * UI gating only for now; not a security boundary. A future employee module
 * will move roles into the database and add RLS enforcement.
 */
export function canEditInvoice(status: InvoiceStatus, role: string): boolean {
  if (status === 'void') return false
  return status === 'draft' || role === 'admin'
}
