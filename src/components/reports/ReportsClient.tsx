'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatCurrency, formatDate } from '@/lib/utils'
import { statusBadgeVariant } from '@/lib/status-badge'
import type { ReportSummary } from '@/lib/reports'

const BRAND_CHART = '#766254'
const BRAND_CHART_SOFT = '#9b8779'

// Interactive shell for the reports page. The Server Component fetches + computes
// `summary`; this island renders it and drives the date range through the URL so
// a change re-runs the server query. `isPending` shows the in-flight spinner.
export function ReportsClient({ from, to, summary }: { from: string; to: string; summary: ReportSummary }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const setRange = (next: { from?: string; to?: string }) => {
    const params = new URLSearchParams({ from: next.from ?? from, to: next.to ?? to })
    startTransition(() => router.push(`/reports?${params.toString()}`))
  }

  const { totalInvoiced, totalPaidInvoices, totalOutstanding, invoiceCount, outstanding, paid, byCustomer, byProduct } = summary

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sales Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Revenue and outstanding analysis</p>
      </div>

      {/* Date range */}
      <div className="flex gap-4 items-end">
        <div className="space-y-2">
          <Label>From</Label>
          <Input type="date" value={from} onChange={e => setRange({ from: e.target.value })} className="w-40" />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <Input type="date" value={to} onChange={e => setRange({ to: e.target.value })} className="w-40" />
        </div>
        {isPending && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mb-2" />}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Invoiced</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalInvoiced)}</p><p className="text-xs text-muted-foreground mt-1">{invoiceCount} invoices</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected (Paid)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{formatCurrency(totalPaidInvoices)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Outstanding</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-yellow-600">{formatCurrency(totalOutstanding)}</p><p className="text-xs text-muted-foreground mt-1">{outstanding.length} unpaid</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="outstanding">
        <TabsList>
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="customers">By Clinic</TabsTrigger>
          <TabsTrigger value="products">By Product</TabsTrigger>
        </TabsList>

        <TabsContent value="outstanding" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Outstanding Invoices</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Aging</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstanding.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No outstanding invoices</TableCell></TableRow>}
                  {outstanding.map(inv => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                      <TableCell>{inv.customers?.clinic_name}</TableCell>
                      <TableCell className="text-sm">{formatDate(inv.due_date)}</TableCell>
                      <TableCell>
                        {inv.daysOverdue > 0 ? (
                          <span className={`text-sm font-medium ${inv.daysOverdue > 60 ? 'text-red-600' : inv.daysOverdue > 30 ? 'text-orange-500' : 'text-yellow-600'}`}>
                            {inv.daysOverdue}d overdue
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not due yet</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant('payment', inv.status)} className="capitalize">{inv.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Paid Invoices</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paid.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No paid invoices in this period</TableCell></TableRow>}
                  {paid.map(inv => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                      <TableCell>{inv.customers?.clinic_name}</TableCell>
                      <TableCell className="text-sm">{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant('payment', inv.status)} className="capitalize">{inv.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue by Clinic (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {byCustomer.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byCustomer} layout="vertical" margin={{ left: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" fill={BRAND_CHART} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-muted-foreground py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue by Product (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {byProduct.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byProduct} layout="vertical" margin={{ left: 160 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" fill={BRAND_CHART_SOFT} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-muted-foreground py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
