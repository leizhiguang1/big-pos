'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isVoided } from '@/lib/invoice-status'
import { statusBadgeVariant } from '@/lib/status-badge'
import type { Invoice } from '@/lib/database.types'

// Read-only invoice history for a customer, with rows that navigate to the
// invoice. Client island only because the rows are clickable; the data is
// fetched server-side and passed in.
export function CustomerInvoiceHistory({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter()

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Invoice History</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No invoices yet</TableCell></TableRow>
            )}
            {invoices.map(inv => (
              <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(inv.invoice_date)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(inv.due_date)}</TableCell>
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
      </CardContent>
    </Card>
  )
}
