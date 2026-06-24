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
  WorkStatusConfig,
} from '@/lib/database.types'
import { isVoided } from '@/lib/invoice-status'
import { getBillingSettings } from '@/data/billing-settings'
import { paginate } from '@/lib/pagination'

// --- Return types ----------------------------------------------------------

// List row: an invoice plus the relations the list query embeds. Mirrors the
// page's local `InvoiceWithItems` shape.
export type InvoiceListRow = Invoice & {
  customers?: { clinic_name: string } | null
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
  workStatusConfigs: WorkStatusConfig[]
  serviceStatuses: ServiceStatus[]
}

// Reference data the create/edit form needs on mount.
export type InvoiceFormData = {
  customers: Customer[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
  /** Lab's standard payment terms (days) — derives a new invoice's due date. */
  paymentTermsDays: number
}

// Edit-mode prefill: the invoice header + its line items.
export type InvoiceForEdit = {
  invoice: Invoice
  items: InvoiceItem[]
}

// --- Queries ---------------------------------------------------------------

// List query — mirrors `invoices/page.tsx`:
//   .select('*, customers(clinic_name), service_statuses(*)')
//   .order('created_at', { ascending: false })
export async function getInvoices(): Promise<InvoiceListRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customers(clinic_name), service_statuses(*)')
    .order('created_at', { ascending: false })
  return (data ?? []) as InvoiceListRow[]
}

// --- Paginated list (URL-driven) -------------------------------------------

export type InvoiceView = 'all' | 'drafts' | 'unpaid' | 'voided'

export interface InvoiceListParams {
  q?: string
  view?: InvoiceView
  page?: number
  pageSize?: number
  sort?: string | null
  dir?: 'asc' | 'desc'
}

export interface InvoiceListPage {
  rows: InvoiceListRow[]
  /** Total rows matching the query+view (across all pages). */
  total: number
  page: number
  totalPages: number
  pageStart: number
  pageEnd: number
}

// Columns we let the URL sort by, mapped to row accessors. Sorting runs in JS:
// the dataset is tiny and several views already need a JS pass (derived rollup),
// so a single in-memory sort keeps the code uniform and correct.
const INVOICE_SORTERS: Record<string, (r: InvoiceListRow) => string | number> = {
  number: r => r.invoice_number.toLowerCase(),
  customer: r => (r.customers?.clinic_name ?? '').toLowerCase(),
  patient: r => (r.patient ?? '').toLowerCase(),
  date: r => r.invoice_date ?? '',
  amount: r => Number(r.total),
}

/**
 * URL-driven invoices list: server-side search + view filter + sort, paginated.
 * The view filters (plain status, voided) push into SQL; only the clinic-name
 * search and the sort run in JS over the fetched rows (tiny dataset, and the
 * clinic name lives on an embedded relation an `.or()` can't reach).
 * Work status is tracked per service item, never rolled up to the invoice, so
 * there are no work-based invoice views.
 */
export async function getInvoicesPage(params: InvoiceListParams = {}): Promise<InvoiceListPage> {
  const { q = '', view = 'all', page = 1, pageSize = 15, sort = null, dir = 'asc' } = params
  const supabase = await createClient()

  let query = supabase
    .from('invoices')
    .select('*, customers(clinic_name), service_statuses(*)')
    .order('created_at', { ascending: false })

  // Cheap status/voided filters → SQL.
  if (view === 'voided') {
    query = query.not('voided_at', 'is', null)
  } else {
    query = query.is('voided_at', null)
    if (view === 'drafts') query = query.eq('status', 'draft')
    else if (view === 'unpaid') query = query.in('status', ['sent', 'partial', 'overdue'])
  }

  // Search across invoice number / clinic name / patient. clinic_name lives on
  // the embedded relation, so an `.or()` over the base table can't reach it;
  // match invoice_number + patient in SQL and let the JS pass cover clinic name.
  const term = q.trim()
  if (term) {
    const safe = term.replace(/[%,]/g, ' ')
    query = query.or(`invoice_number.ilike.%${safe}%,patient.ilike.%${safe}%`)
  }

  const { data } = await query
  let rows = (data ?? []) as InvoiceListRow[]

  // Clinic-name search (relation column) — JS pass over the SQL results. We only
  // *widen* the SQL match (which already covered number + patient) so rows that
  // matched in SQL are kept regardless.
  if (term) {
    const lc = term.toLowerCase()
    rows = rows.filter(
      inv =>
        inv.invoice_number.toLowerCase().includes(lc) ||
        (inv.patient ?? '').toLowerCase().includes(lc) ||
        (inv.customers?.clinic_name ?? '').toLowerCase().includes(lc),
    )
  }

  // Sort → JS (default ordering is the SQL created_at desc above).
  const sorter = sort ? INVOICE_SORTERS[sort] : undefined
  if (sorter) {
    rows = [...rows].sort((a, b) => {
      const av = sorter(a)
      const bv = sorter(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return dir === 'desc' ? -cmp : cmp
    })
  }

  const total = rows.length
  const sliced = paginate(rows, page, pageSize)
  return {
    rows: sliced.pageItems,
    total,
    page: sliced.page,
    totalPages: sliced.totalPages,
    pageStart: sliced.pageStart,
    pageEnd: sliced.pageEnd,
  }
}

/**
 * Per-view counts for the saved-view tabs. Mirrors `getInvoicesPage`'s filter
 * logic over the full set so each tab shows its total (independent of the
 * currently-selected view). Cheap at this scale: one read, counted in JS.
 */
export async function getInvoiceViewCounts(): Promise<Record<InvoiceView, number>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customers(clinic_name), service_statuses(*)')
  const all = (data ?? []) as InvoiceListRow[]
  return {
    all: all.length,
    drafts: all.filter(i => !isVoided(i) && i.status === 'draft').length,
    unpaid: all.filter(i => !isVoided(i) && ['sent', 'partial', 'overdue'].includes(i.status)).length,
    voided: all.filter(i => isVoided(i)).length,
  }
}

// Detail bundle — mirrors the 6 parallel reads in `[id]/page.tsx`'s `load()`,
// plus the history read that depends on the item ids. Returns `null` when the
// invoice row is missing.
export async function getInvoiceDetail(id: string): Promise<InvoiceDetailBundle | null> {
  const supabase = await createClient()

  const [invRes, itemsRes, paymentsRes, ssRes, prodRes, stagesRes, statusConfigsRes] = await Promise.all([
    supabase.from('invoices').select('*, customers(*), service_statuses(*)').eq('id', id).single(),
    // sort_order preserves the order lines were entered and is stable across
    // work-status updates (created_at alone ties → heap order, which an UPDATE
    // relocates). created_at is a defensive tiebreaker for any pre-backfill rows.
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order').order('created_at'),
    supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
    supabase.from('service_statuses').select('*').eq('is_active', true).order('sort_order').order('label'),
    supabase.from('products').select('*').eq('active', true).order('created_at'),
    supabase.from('work_stages').select('*').order('sort_order').order('label'),
    supabase.from('work_status_configs').select('*').order('sort_order'),
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
    workStatusConfigs: (statusConfigsRes.data ?? []) as WorkStatusConfig[],
    serviceStatuses: (ssRes.data ?? []) as ServiceStatus[],
  }
}

export async function getWorkStatusConfigs(): Promise<WorkStatusConfig[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('work_status_configs')
    .select('*')
    .order('sort_order')
  return (data ?? []) as WorkStatusConfig[]
}

// Reference data for the form — mirrors `InvoiceForm.tsx`'s mount-time reads:
//   customers ordered by clinic_name, active products by created_at,
//   active service statuses.
export async function getInvoiceFormData(): Promise<InvoiceFormData> {
  const supabase = await createClient()
  const [cRes, pRes, ssRes, billingSettings] = await Promise.all([
    supabase.from('customers').select('*').order('clinic_name'),
    supabase.from('products').select('*').eq('active', true).order('created_at'),
    supabase.from('service_statuses').select('*').eq('is_active', true).order('sort_order').order('label'),
    getBillingSettings(),
  ])
  return {
    customers: (cRes.data ?? []) as Customer[],
    products: (pRes.data ?? []) as Product[],
    serviceStatuses: (ssRes.data ?? []) as ServiceStatus[],
    paymentTermsDays: billingSettings.paymentTermsDays,
  }
}

// Edit-mode prefill — mirrors `InvoiceForm.tsx`'s edit-mode reads. Returns
// `null` when the invoice row is missing.
export async function getInvoiceForEdit(id: string): Promise<InvoiceForEdit | null> {
  const supabase = await createClient()
  const [invRes, itemsRes] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', id).single(),
    // Match getInvoiceDetail: keep the edit form's rows in entered order.
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order').order('created_at'),
  ])
  if (!invRes.data) return null
  return {
    invoice: invRes.data as Invoice,
    items: (itemsRes.data ?? []) as InvoiceItem[],
  }
}
