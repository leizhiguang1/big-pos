// Sales Reports — server-first. The date range lives in the URL
// (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, defaulting to the current month) so the
// query + aggregation run on the server; changing the range re-navigates. The
// interactive UI (date inputs, tabs, tables, charts) is a single client island.

import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { getReportInvoices, getReportPayments } from '@/data/reports'
import { summarizeReports } from '@/lib/reports'
import { buildPresets } from '@/lib/reports-presets'
import { requirePermission } from '@/lib/auth/require-permission'
import { ReportsClient } from '@/components/reports/ReportsClient'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const gate = await requirePermission('reports.view')
  if (gate.ok === false) redirect('/dashboard')

  const sp = await searchParams
  const now = new Date()
  const from = sp.from ?? format(startOfMonth(now), 'yyyy-MM-dd')
  const to = sp.to ?? format(endOfMonth(now), 'yyyy-MM-dd')

  const [invoices, payments] = await Promise.all([
    getReportInvoices(from, to),
    getReportPayments(from, to),
  ])
  const summary = summarizeReports(invoices, now.getTime())
  const presets = buildPresets(now)

  return <ReportsClient from={from} to={to} summary={summary} presets={presets} payments={payments} />
}
