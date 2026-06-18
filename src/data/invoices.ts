// Server-side READ query functions for the invoices module.
//
// These run inside Server Components via the SSR client (`await createClient()`),
// which is RLS-aware through the session cookie. They mirror, verbatim, the
// queries the current client pages run today — same `.select(...)` strings and
// ordering — so the move to server-first rendering is behavior-preserving.
//
// Writes live in `./invoice-actions.ts`.

import { createClient } from '@/lib/supabase/server'
import type {
  Invoice,
  InvoiceItem,
  InvoiceItemStatusHistory,
  Payment,
  Customer,
  Product,
  ServiceStatus,
  WorkStage,
  WorkStatus,
} from '@/lib/database.types'

// --- Return types ----------------------------------------------------------

// List row: an invoice plus the relations the list query embeds. Mirrors the
// page's local `InvoiceWithItems` shape.
export type InvoiceListRow = Invoice & {
  customers?: { clinic_name: string } | null
  invoice_items?: Array<{ work_status: WorkStatus }>
  service_statuses?: ServiceStatus | null
}

// Detail invoice: the header row with its embedded customer + service status.
export type InvoiceDetail = Invoice & {
  customers?: Customer | null
  service_statuses?: ServiceStatus | null
}

// The full bundle the detail page needs, fetched in parallel.
export type InvoiceDetailBundle = {
  invoice: InvoiceDetail
  items: InvoiceItem[]
  payments: Payment[]
  history: InvoiceItemStatusHistory[]
  products: Product[]
  stages: WorkStage[]
  serviceStatuses: ServiceStatus[]
}

// Reference data the create/edit form needs on mount.
export type InvoiceFormData = {
  customers: Customer[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
}

// Edit-mode prefill: the invoice header + its line items.
export type InvoiceForEdit = {
  invoice: Invoice
  items: InvoiceItem[]
}

// --- Queries ---------------------------------------------------------------

// List query — mirrors `invoices/page.tsx`:
//   .select('*, customers(clinic_name), invoice_items(work_status), service_statuses(*)')
//   .order('created_at', { ascending: false })
export async function getInvoices(): Promise<InvoiceListRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customers(clinic_name), invoice_items(work_status), service_statuses(*)')
    .order('created_at', { ascending: false })
  return (data ?? []) as InvoiceListRow[]
}

// Detail bundle — mirrors the 6 parallel reads in `[id]/page.tsx`'s `load()`,
// plus the history read that depends on the item ids. Returns `null` when the
// invoice row is missing.
export async function getInvoiceDetail(id: string): Promise<InvoiceDetailBundle | null> {
  const supabase = await createClient()

  const [invRes, itemsRes, paymentsRes, ssRes, prodRes, stagesRes] = await Promise.all([
    supabase.from('invoices').select('*, customers(*), service_statuses(*)').eq('id', id).single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
    supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
    supabase.from('service_statuses').select('*').eq('is_active', true).order('sort_order').order('label'),
    supabase.from('products').select('*').eq('active', true).order('created_at'),
    supabase.from('work_stages').select('*').order('sort_order').order('label'),
  ])

  if (!invRes.data) return null

  const items = (itemsRes.data ?? []) as InvoiceItem[]

  // History depends on the loaded item ids, so it runs after the parallel batch.
  let history: InvoiceItemStatusHistory[] = []
  if (items.length > 0) {
    const { data: histRows } = await supabase
      .from('invoice_item_status_history')
      .select('*')
      .in('invoice_item_id', items.map(i => i.id))
      .order('changed_at', { ascending: false })
    history = (histRows ?? []) as InvoiceItemStatusHistory[]
  }

  return {
    invoice: invRes.data as InvoiceDetail,
    items,
    payments: (paymentsRes.data ?? []) as Payment[],
    history,
    products: (prodRes.data ?? []) as Product[],
    stages: (stagesRes.data ?? []) as WorkStage[],
    serviceStatuses: (ssRes.data ?? []) as ServiceStatus[],
  }
}

// Reference data for the form — mirrors `InvoiceForm.tsx`'s mount-time reads:
//   customers ordered by clinic_name, active products by created_at,
//   active service statuses.
export async function getInvoiceFormData(): Promise<InvoiceFormData> {
  const supabase = await createClient()
  const [cRes, pRes, ssRes] = await Promise.all([
    supabase.from('customers').select('*').order('clinic_name'),
    supabase.from('products').select('*').eq('active', true).order('created_at'),
    supabase.from('service_statuses').select('*').eq('is_active', true).order('sort_order').order('label'),
  ])
  return {
    customers: (cRes.data ?? []) as Customer[],
    products: (pRes.data ?? []) as Product[],
    serviceStatuses: (ssRes.data ?? []) as ServiceStatus[],
  }
}

// Edit-mode prefill — mirrors `InvoiceForm.tsx`'s edit-mode reads. Returns
// `null` when the invoice row is missing.
export async function getInvoiceForEdit(id: string): Promise<InvoiceForEdit | null> {
  const supabase = await createClient()
  const [invRes, itemsRes] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', id).single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
  ])
  if (!invRes.data) return null
  return {
    invoice: invRes.data as Invoice,
    items: (itemsRes.data ?? []) as InvoiceItem[],
  }
}
