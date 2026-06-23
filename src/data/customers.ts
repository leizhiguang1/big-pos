// Server-side READ query functions for the customers module.
//
// These run inside Server Components via the SSR client (`await createClient()`),
// which is RLS-aware through the session cookie. They mirror, verbatim, the
// queries the current client pages run today — same `.select(...)` strings and
// ordering — so the move to server-first rendering is behavior-preserving.
//
// Writes live in `./customer-actions.ts`.

import { createClient } from '@/lib/supabase/server'
import type { Customer, Invoice } from '@/lib/database.types'
import type { StatementInvoiceRow, StatementPaymentRow, StatementCreditRow } from '@/lib/statement'

// The bundle the detail page needs: the customer plus its invoice history.
export type CustomerDetail = {
  customer: Customer
  invoices: Invoice[]
}

// List query — mirrors `customers/page.tsx`:
//   .select('*').order('clinic_name')
export async function getCustomers(): Promise<Customer[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('customers').select('*').order('clinic_name')
  return (data ?? []) as Customer[]
}

// --- Paginated list (URL-driven) -------------------------------------------

export interface CustomerListParams {
  q?: string
  page?: number
  pageSize?: number
  sort?: string | null
  dir?: 'asc' | 'desc'
}

export interface CustomerListPage {
  rows: Customer[]
  total: number
  page: number
  totalPages: number
  pageStart: number
  pageEnd: number
}

// Sortable columns → DB column names. Default order is clinic_name asc.
const CUSTOMER_SORT_COLUMNS: Record<string, string> = {
  clinic: 'clinic_name',
  contact: 'contact_person',
  registered: 'created_at',
}

/**
 * URL-driven clinics list: server-side search + sort + pagination via
 * `.order().range()` with an exact count. Search spans clinic name / contact /
 * phone (all base-table columns, so the whole filter lives in SQL).
 */
export async function getCustomersPage(params: CustomerListParams = {}): Promise<CustomerListPage> {
  const { q = '', page = 1, pageSize = 15, sort = null, dir = 'asc' } = params
  const supabase = await createClient()

  const sortCol = (sort && CUSTOMER_SORT_COLUMNS[sort]) || 'clinic_name'

  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: dir !== 'desc' })

  const term = q.trim()
  if (term) {
    const safe = term.replace(/[%,]/g, ' ')
    query = query.or(`clinic_name.ilike.%${safe}%,contact_person.ilike.%${safe}%,phone.ilike.%${safe}%`)
  }

  const safePage = Math.max(1, page)
  const from = (safePage - 1) * pageSize
  const { data, count } = await query.range(from, from + pageSize - 1)

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(safePage, totalPages)
  const rows = (data ?? []) as Customer[]
  return {
    rows,
    total,
    page: clamped,
    totalPages,
    pageStart: total === 0 ? 0 : from + 1,
    pageEnd: from + rows.length,
  }
}

// Detail bundle — mirrors the 2 parallel reads in `[id]/page.tsx`. Returns
// `null` when the customer row is missing.
export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  const supabase = await createClient()
  const [cRes, iRes] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    supabase.from('invoices').select('*').eq('customer_id', id).order('invoice_date', { ascending: false }),
  ])
  if (!cRes.data) return null
  return {
    customer: cRes.data as Customer,
    invoices: (iRes.data ?? []) as Invoice[],
  }
}

// Statement bundle — fetches the clinic row, its non-voided invoices (fields
// needed by buildStatement), and all payment rows for those invoices. Returns
// `null` when the clinic row is missing.
export type ClinicStatementBundle = {
  clinic: Customer
  invoices: StatementInvoiceRow[]
  payments: StatementPaymentRow[]
  credits: StatementCreditRow[]
}

export async function getClinicStatement(id: string): Promise<ClinicStatementBundle | null> {
  const supabase = await createClient()

  // Fetch clinic + non-voided invoices + the clinic's account credits in parallel.
  const [cRes, iRes, crRes] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, due_date, patient, total, status, voided_at')
      .eq('customer_id', id)
      .is('voided_at', null)
      .order('invoice_date', { ascending: true }),
    supabase
      .from('credits')
      .select('credit_date, amount, reason, invoice_id')
      .eq('customer_id', id)
      .order('credit_date', { ascending: true }),
  ])

  if (!cRes.data) return null

  const invoices = (iRes.data ?? []) as StatementInvoiceRow[]
  const credits = (crRes.data ?? []) as StatementCreditRow[]

  // Fetch payments for these invoices (empty result set if no invoices)
  let payments: StatementPaymentRow[] = []
  if (invoices.length > 0) {
    const invoiceIds = invoices.map((i) => i.id)
    const { data: pData } = await supabase
      .from('payments')
      .select('invoice_id, amount')
      .in('invoice_id', invoiceIds)
    payments = (pData ?? []) as StatementPaymentRow[]
  }

  return {
    clinic: cRes.data as Customer,
    invoices,
    payments,
    credits,
  }
}

// Edit-mode prefill — mirrors `CustomerForm`'s edit-mode read. Returns `null`
// when the customer row is missing.
export async function getCustomerForEdit(id: string): Promise<Customer | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('customers').select('*').eq('id', id).single()
  return (data ?? null) as Customer | null
}
