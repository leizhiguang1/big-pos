'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatCurrency, formatDate } from '@/lib/utils'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import type { Invoice } from '@/lib/database.types'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  draft: 'secondary', sent: 'info', partial: 'warning', paid: 'success', overdue: 'destructive', void: 'secondary',
}

export default function ReportsPage() {
  const router = useRouter()
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(subMonths(new Date(), 0)), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('invoices')
      .select('*, customers(clinic_name), invoice_items(*, products(name))')
      .gte('invoice_date', dateFrom)
      .lte('invoice_date', dateTo)
      .then(({ data }) => {
        setInvoices((data ?? []) as Invoice[])
        setLoading(false)
      })
  }, [dateFrom, dateTo])

  // Revenue summary
  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0)
  const totalPaidInvoices = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0)
  const totalOutstanding = invoices
    .filter(i => ['sent', 'partial', 'overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.total), 0)

  // Outstanding invoices with aging
  const now = new Date()
  const outstanding = invoices
    .filter(i => ['sent', 'partial', 'overdue'].includes(i.status))
    .map(i => {
      const dueDate = new Date(i.due_date)
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000)
      return { ...i, daysOverdue }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  // Sales by customer
  const byCustomer = Object.values(
    invoices.reduce((acc, inv) => {
      const name = (inv.customers as { clinic_name: string })?.clinic_name ?? 'Unknown'
      if (!acc[name]) acc[name] = { name, total: 0, count: 0 }
      acc[name].total += Number(inv.total)
      acc[name].count += 1
      return acc
    }, {} as Record<string, { name: string; total: number; count: number }>)
  ).sort((a, b) => b.total - a.total).slice(0, 10)

  // Sales by product
  const byProduct: Record<string, { name: string; total: number; qty: number }> = {}
  invoices.forEach(inv => {
    const items = (inv.invoice_items ?? []) as Array<{ description: string; amount: number; quantity: number; products?: { name: string } }>
    items.forEach(item => {
      const name = item.products?.name ?? item.description
      if (!byProduct[name]) byProduct[name] = { name, total: 0, qty: 0 }
      byProduct[name].total += Number(item.amount)
      byProduct[name].qty += Number(item.quantity)
    })
  })
  const byProductSorted = Object.values(byProduct).sort((a, b) => b.total - a.total).slice(0, 10)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sales Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Revenue and outstanding analysis</p>
      </div>

      {/* Date range */}
      <div className="flex gap-4 items-end">
        <div className="space-y-2">
          <Label>From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        {loading && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mb-2" />}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Total Invoiced</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalInvoiced)}</p><p className="text-xs text-gray-400 mt-1">{invoices.length} invoices</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Collected (Paid)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{formatCurrency(totalPaidInvoices)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Outstanding</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-yellow-600">{formatCurrency(totalOutstanding)}</p><p className="text-xs text-gray-400 mt-1">{outstanding.length} unpaid</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="outstanding">
        <TabsList>
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
          <TabsTrigger value="customers">By Customer</TabsTrigger>
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
                    <TableHead>Customer</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Aging</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstanding.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">No outstanding invoices</TableCell></TableRow>}
                  {outstanding.map(inv => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                      <TableCell>{(inv.customers as { clinic_name: string })?.clinic_name}</TableCell>
                      <TableCell className="text-sm">{formatDate(inv.due_date)}</TableCell>
                      <TableCell>
                        {inv.daysOverdue > 0 ? (
                          <span className={`text-sm font-medium ${inv.daysOverdue > 60 ? 'text-red-600' : inv.daysOverdue > 30 ? 'text-orange-500' : 'text-yellow-600'}`}>
                            {inv.daysOverdue}d overdue
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Not due yet</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[inv.status] ?? 'secondary'} className="capitalize">{inv.status}</Badge>
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
            <CardHeader><CardTitle className="text-base">Revenue by Customer (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {byCustomer.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byCustomer} layout="vertical" margin={{ left: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" fill="#5C3117" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-gray-400 py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue by Product (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {byProductSorted.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byProductSorted} layout="vertical" margin={{ left: 160 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `RM${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" fill="#8B5A2B" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-gray-400 py-8">No data for this period</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
