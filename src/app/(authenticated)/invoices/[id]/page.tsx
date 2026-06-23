// Invoice detail — server-first. This Server Component fetches the whole bundle
// via `getInvoiceDetail`, computes the money totals, and renders the read-only
// sections (printable document chrome + payment history) server-side. Every
// interactive section is a client island under `@/components/invoices/detail/`
// that receives its data slice and calls a Server Action.

import { notFound } from 'next/navigation'
import { getInvoiceDetail } from '@/data/invoices'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isVoided } from '@/lib/invoice-status'
import { InvoiceDetailClient } from '@/components/invoices/detail/InvoiceDetailClient'
import { CaseDetailsEditor } from '@/components/invoices/detail/CaseDetailsEditor'
import { ServiceStatusSelector } from '@/components/invoices/detail/ServiceStatusSelector'
import { WorkStatusEditor } from '@/components/invoices/detail/WorkStatusEditor'

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getInvoiceDetail(id)
  if (!data) notFound()

  const { invoice, items, payments, history, products, stages, serviceStatuses } = data
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

  return (
    <div className="max-w-4xl space-y-6">
      {/* Actions bar + printable document (coupled interactive chrome). */}
      <InvoiceDetailClient
        invoice={invoice}
        items={items}
        products={products}
        serviceStatuses={serviceStatuses}
        currentServiceStatus={currentServiceStatus}
        customerName={customer?.clinic_name ?? null}
        totalPaid={totalPaid}
        outstanding={outstanding}
        unrecorded={unrecorded}
      />

      {/* Internal remarks — staff-only, never printed. Stored in invoices.notes. */}
      {invoice.notes?.trim() && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Remarks</CardTitle>
            <p className="text-xs text-gray-500">Internal only — not shown to the customer.</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-line">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Case details — editable island, hidden on print */}
      {!voided && <CaseDetailsEditor invoice={invoice} />}

      {/* Service status — editable island, hidden on print */}
      {!voided && (
        <ServiceStatusSelector
          invoiceId={invoice.id}
          serviceStatusId={invoice.service_status_id}
          serviceStatuses={serviceStatuses}
        />
      )}

      {/* Work status — editable island, hidden on print */}
      {!voided && items.length > 0 && (
        <WorkStatusEditor items={items} history={history} stages={stages} />
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
                    <TableCell className="text-sm text-gray-500">{p.notes ?? '—'}</TableCell>
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
