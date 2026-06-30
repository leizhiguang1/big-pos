'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatCurrency, formatDate, todayISODate } from '@/lib/utils'
import { statusBadgeVariant, paymentStatusLabel } from '@/lib/status-badge'
import type { ReportSummary } from '@/lib/reports'
import {
  buildSalesReportCsv,
  buildPaymentReportCsv,
  buildItemSalesReportCsv,
  salesReportFilename,
  paymentReportFilename,
  itemSalesReportFilename,
} from '@/lib/reports-exports'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { ReportPayment } from '@/lib/reports'
import { matchPreset, PRESET_LABELS, type PresetKind, type PresetMap } from '@/lib/reports-presets'

const BRAND_CHART = '#766254'
const BRAND_CHART_SOFT = '#9b8779'

// Interactive shell for the reports page. The Server Component fetches + computes
// `summary`; this island renders it and drives the date range through the URL so
// a change re-runs the server query. `isPending` shows the in-flight spinner.
export function ReportsClient({ from, to, summary, presets, payments }: { from: string; to: string; summary: ReportSummary; presets: PresetMap; payments: ReportPayment[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const setRange = (next: { from?: string; to?: string }) => {
    const params = new URLSearchParams({ from: next.from ?? from, to: next.to ?? to })
    startTransition(() => router.push(`/reports?${params.toString()}`))
  }

  // Download a CSV string as a file. The leading BOM makes Excel open the UTF-8
  // file with clinic names intact.
  const download = (csv: string, filename: string) => {
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const range = { from, to }
  const exportSales = () => download(buildSalesReportCsv(summary.sales, range, todayISODate()), salesReportFilename(range))
  const exportPayments = () => download(buildPaymentReportCsv(payments, range, todayISODate()), paymentReportFilename(range))
  const exportItems = () => download(buildItemSalesReportCsv(summary.byProduct, range, todayISODate()), itemSalesReportFilename(range))

  const { totalInvoiced, totalPaidInvoices, totalOutstanding, invoiceCount, outstanding, paid, byCustomer, byProduct } = summary
  const activeRange = matchPreset(from, to, presets)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Sales Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Revenue and outstanding analysis</p>
      </div>

      {/* Quick range presets */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as PresetKind[]).map(kind => (
          <Button
            key={kind}
            size="sm"
            variant={activeRange === kind ? 'default' : 'outline'}
            onClick={() => setRange(presets[kind])}
          >
            {PRESET_LABELS[kind]}
          </Button>
        ))}
        <Button size="sm" variant={activeRange === 'custom' ? 'default' : 'outline'} className="pointer-events-none">
          Custom
        </Button>
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Label>From</Label>
          <Input type="date" value={from} onChange={e => setRange({ from: e.target.value })} className="w-full sm:w-40" />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <Input type="date" value={to} onChange={e => setRange({ to: e.target.value })} className="w-full sm:w-40" />
        </div>
        {isPending && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mb-2" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={invoiceCount === 0} className="w-full sm:w-auto sm:ml-auto">
              <Download className="h-4 w-4 mr-2" />
              Export
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportSales}>Sales Report</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportPayments}>Payment Report</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportItems}>Item Sales Report</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              <Table className="min-w-[48rem]">
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
                        <Badge variant={statusBadgeVariant('payment', inv.status)}>{paymentStatusLabel(inv.status)}</Badge>
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
              <Table className="min-w-[42rem]">
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
                        <Badge variant={statusBadgeVariant('payment', inv.status)}>{paymentStatusLabel(inv.status)}</Badge>
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
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={byCustomer.slice(0, 10)} layout="vertical" margin={{ left: 120 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="total" fill={BRAND_CHART} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-6 overflow-x-auto">
                    <p className="text-sm font-medium text-muted-foreground mb-2">All clinics</p>
                    <Table className="min-w-[28rem]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Clinic</TableHead>
                          <TableHead className="text-right">Invoices</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {byCustomer.map(c => (
                          <TableRow key={c.name}>
                            <TableCell>{c.name}</TableCell>
                            <TableCell className="text-right">{c.count}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(c.total)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{byCustomer.reduce((s, c) => s + c.count, 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(byCustomer.reduce((s, c) => s + c.total, 0))}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : <p className="text-center text-muted-foreground py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue by Product (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {byProduct.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={byProduct.slice(0, 10)} layout="vertical" margin={{ left: 160 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="total" fill={BRAND_CHART_SOFT} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-6 overflow-x-auto">
                    <p className="text-sm font-medium text-muted-foreground mb-2">All products</p>
                    <Table className="min-w-[28rem]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {byProduct.map(p => (
                          <TableRow key={p.name}>
                            <TableCell>{p.name}</TableCell>
                            <TableCell className="text-right">{p.qty}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(p.total)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{byProduct.reduce((s, p) => s + p.qty, 0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(byProduct.reduce((s, p) => s + p.total, 0))}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : <p className="text-center text-muted-foreground py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
