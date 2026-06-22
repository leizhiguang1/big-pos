// Server-side READ query for the dashboard.
//
// Runs inside the Server Component via the SSR client (RLS-aware). Mirrors the
// three parallel reads the old client page ran; the page computes the month
// stats from this bundle.

import { createClient } from '@/lib/supabase/server'
import type { Invoice } from '@/lib/database.types'

// Slim projection used for the headline stat cards.
export type DashboardStatsInvoice = Pick<Invoice, 'total' | 'status' | 'invoice_date' | 'due_date' | 'voided_at'>

// Recent-invoice row with the embedded customer name.
export type DashboardRecentInvoice = Invoice & { customers?: { clinic_name: string } | null }

export type DashboardData = {
  statsInvoices: DashboardStatsInvoice[]
  customerCount: number
  recentInvoices: DashboardRecentInvoice[]
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient()
  const [invoicesRes, customersRes, recentRes] = await Promise.all([
    supabase.from('invoices').select('total, status, invoice_date, due_date, voided_at'),
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('invoices').select('*, customers(clinic_name)').order('created_at', { ascending: false }).limit(8),
  ])
  return {
    statsInvoices: (invoicesRes.data ?? []) as DashboardStatsInvoice[],
    customerCount: customersRes.count ?? 0,
    recentInvoices: (recentRes.data ?? []) as DashboardRecentInvoice[],
  }
}
