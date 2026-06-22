// Dashboard — server-first. Fetches the stat bundle via `getDashboardData` and
// computes the month revenue / outstanding server-side; the recent-invoices
// table is a client island (clickable rows).

import Link from 'next/link'
import { getDashboardData } from '@/data/dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { FileText, Users, DollarSign, AlertCircle, Plus } from 'lucide-react'
import { countsAsRevenue, isOutstanding } from '@/lib/invoice-status'
import { DashboardRecentInvoices } from '@/components/dashboard/DashboardRecentInvoices'

export default async function DashboardPage() {
  const { statsInvoices, customerCount, recentInvoices } = await getDashboardData()

  // Month-to-date revenue + total outstanding, computed server-side (mirrors the
  // original page). `firstOfMonth` is the local first-of-month yyyy-MM-dd.
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const revenue = statsInvoices
    .filter(i => countsAsRevenue(i) && i.due_date >= firstOfMonth)
    .reduce((s, i) => s + Number(i.total), 0)
  const outstanding = statsInvoices
    .filter(i => isOutstanding(i))
    .reduce((s, i) => s + Number(i.total), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Welcome back</p>
        </div>
        <Button asChild>
          <Link href="/invoices/new"><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Revenue (Month)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(revenue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">{formatCurrency(outstanding)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Invoices</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{statsInvoices.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{customerCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Invoices</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/invoices">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <DashboardRecentInvoices invoices={recentInvoices} />
        </CardContent>
      </Card>
    </div>
  )
}
