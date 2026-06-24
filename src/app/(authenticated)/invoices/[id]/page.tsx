// Invoice detail — server-first. This Server Component fetches the whole bundle
// via `getInvoiceDetail`, computes the money totals, and renders the read-only
// sections (printable document chrome + payment history) server-side. Every
// interactive section is a client island under `@/components/invoices/detail/`
// that receives its data slice and calls a Server Action.
//
// Layout is editors-first: the at-a-glance status strip and the daily editors
// (work status, service status, case details) render between the actions bar and
// the printable document, so staff no longer scroll past the whole invoice to
// update a case.

import { notFound } from 'next/navigation'
import { getInvoiceDetail } from '@/data/invoices'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table'
import { cn, formatCurrency, formatDate, todayISODate } from '@/lib/utils'
import { isVoided, isOverdue } from '@/lib/invoice-status'
import { statusBadgeVariant } from '@/lib/status-badge'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { InvoiceDetailClient } from '@/components/invoices/detail/InvoiceDetailClient'
import { CaseDetailsEditor } from '@/components/invoices/detail/CaseDetailsEditor'
import { WorkStatusEditor } from '@/components/invoices/detail/WorkStatusEditor'

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getInvoiceDetail(id)
  if (!data) notFound()

  const { invoice, items, payments, history, products, stages, workStatusConfigs, serviceStatuses } = data
  const customer = invoice.customers ?? null

  // Money model — computed server-side, mirroring the original page exactly.
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
  // When an invoice is settled (status 'paid'), the balance is zero even if the
  // recorded payments don't sum to the total — e.g. it was marked paid directly.
  const outstanding = invoice.status === 'paid' ? 0 : Number(invoice.total) - totalPaid
  // Pre-fills Record Payment. Unlike `outstanding`, this stays the real unrecorded
  // balance for a 'paid' invoice settled via the shortcut, so the field isn't blank.
  const unrecorded = Math.max(0, Number(invoice.total) - totalPaid)

  // The service status shown on the printed doc (selected id, falling back to the
  // embedded relation), resolved server-side.
  const currentServiceStatus =
    serviceStatuses.find(s => s.id === invoice.service_status_id) ?? invoice.service_statuses ?? null

  const voided = isVoided(invoice)
  const today = todayISODate()
  const overdue = !voided && isOverdue(invoice, today)

  return (
    <div className="max-w-4xl space-y-6">
      {/* Actions bar → [status strip + editors] → printable document. The editors
          are passed as children so they sit between the actions bar and the doc
          without breaking the ActionsBar↔InvoiceDocument print-ref coupling. */}
      <InvoiceDetailClient
        invoice={invoice}
        items={items}
        products={products}
        serviceStatuses={serviceStatuses}
        currentServiceStatus={currentServiceStatus}
        stages={stages}
        workStatusConfigs={workStatusConfigs}
        customerName={customer?.clinic_name ?? null}
        totalPaid={totalPaid}
        unrecorded={unrecorded}
      >
        {/* Case-status strip — payment · service + money, at a glance. Work status is
            tracked per service item (see the Work Status editor below), never rolled
            up to the invoice. */}
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
              {voided ? (
                <Badge variant="destructive" className="uppercase">Voided</Badge>
              ) : overdue ? (
                <Badge variant="destructive">Overdue</Badge>
              ) : (
                <Badge variant={statusBadgeVariant('payment', invoice.status)} className="capitalize">{invoice.status}</Badge>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Service</p>
              {currentServiceStatus ? (
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', currentServiceStatus.color ?? DEFAULT_COLOR)}>
                  {currentServiceStatus.label}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-6">
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="font-semibold tabular-nums">{formatCurrency(Number(invoice.total))}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Paid</p>
                <p className="font-semibold tabular-nums text-green-600">{formatCurrency(totalPaid)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Outstanding</p>
                <p className="font-semibold tabular-nums text-red-600">{formatCurrency(outstanding)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Daily work — above the printable document */}
        {!voided && items.length > 0 && <WorkStatusEditor items={items} history={history} stages={stages} statusConfigs={workStatusConfigs} />}
        {!voided && <CaseDetailsEditor invoice={invoice} serviceStatusId={invoice.service_status_id} serviceStatuses={serviceStatuses} />}
      </InvoiceDetailClient>

      {/* Internal remarks — staff-only, never printed. Stored in invoices.notes. */}
      {invoice.notes?.trim() && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Remarks</CardTitle>
            <p className="text-xs text-muted-foreground">Internal only — not shown to the clinic.</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground whitespace-pre-line">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Payment history — read-only, server-rendered, hidden on print */}
      {payments.length > 0 && (
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                    <TableCell className="text-sm font-mono">{p.reference_number ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.notes ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">{formatCurrency(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">Outstanding</TableCell>
                  <TableCell className="text-right font-bold text-red-600">{formatCurrency(outstanding)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
