'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search } from 'lucide-react'
import type { Invoice, WorkStatus, ServiceStatus } from '@/lib/database.types'
import {
  WORK_STATUSES,
  WORK_STATUS_LABELS,
  dominantWorkStatus,
} from '@/lib/work-status'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { cn } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  draft: 'secondary', sent: 'info', partial: 'warning', paid: 'success', overdue: 'destructive', void: 'secondary',
}

type InvoiceWithItems = Invoice & {
  invoice_items?: Array<{ work_status: WorkStatus }>
  service_statuses?: ServiceStatus | null
}

export default function InvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([])
  const [filtered, setFiltered] = useState<InvoiceWithItems[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [workFilter, setWorkFilter] = useState<'all' | WorkStatus>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('invoices')
      .select('*, customers(clinic_name), invoice_items(work_status), service_statuses(*)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setInvoices((data ?? []) as InvoiceWithItems[])
        setFiltered((data ?? []) as InvoiceWithItems[])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(
      invoices.filter(inv => {
        const matchSearch =
          inv.invoice_number.toLowerCase().includes(q) ||
          ((inv.customers as { clinic_name: string })?.clinic_name ?? '').toLowerCase().includes(q)
        const matchStatus = statusFilter === 'all' || inv.status === statusFilter
        const matchWork =
          workFilter === 'all' ||
          (inv.invoice_items ?? []).some(it => it.work_status === workFilter)
        return matchSearch && matchStatus && matchWork
      })
    )
  }, [search, statusFilter, workFilter, invoices])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} total</p>
        </div>
        <Button asChild>
          <Link href="/invoices/new"><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Search invoice # or customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
        <Select value={workFilter} onValueChange={v => setWorkFilter(v as 'all' | WorkStatus)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All work" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All work</SelectItem>
            {WORK_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{WORK_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Work</TableHead>
                <TableHead>Service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">No invoices found</TableCell></TableRow>}
              {filtered.map(inv => {
                const dominant = dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status))
                const service = inv.service_statuses
                return (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                    <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                    <TableCell className="text-gray-700">{(inv.customers as { clinic_name: string })?.clinic_name ?? '—'}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{formatDate(inv.invoice_date)}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{formatDate(inv.due_date)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[inv.status] ?? 'secondary'} className="capitalize">{inv.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {dominant ? (
                        <WorkStatusBadge status={dominant} />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {service ? (
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', service.color ?? DEFAULT_COLOR)}>
                          {service.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
