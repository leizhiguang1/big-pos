'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isVoided } from '@/lib/invoice-status'
import { statusBadgeVariant } from '@/lib/status-badge'
import type { DashboardRecentInvoice } from '@/data/dashboard'

// Recent-invoices table for the dashboard. Client island only because the rows
// navigate to the invoice; the data is fetched server-side and passed in.
export function DashboardRecentInvoices({ invoices }: { invoices: DashboardRecentInvoice[] }) {
  const router = useRouter()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Clinic</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No invoices yet</TableCell>
          </TableRow>
        )}
        {invoices.map(inv => (
          <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
            <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
            <TableCell>{inv.customers?.clinic_name ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(inv.invoice_date)}</TableCell>
            <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
            <TableCell>
              {isVoided(inv)
                ? <Badge variant="destructive" className="uppercase">Voided</Badge>
                : <Badge variant={statusBadgeVariant('payment', inv.status)} className="capitalize">{inv.status}</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
