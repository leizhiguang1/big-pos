'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import type { Column } from '@/lib/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { listViewState } from '@/lib/list-view-state'
import { statusBadgeVariant } from '@/lib/status-badge'
import { FileText } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatDate, todayISODate } from '@/lib/utils'
import { Plus, Search } from 'lucide-react'
import type { WorkStatus } from '@/lib/database.types'
import {
  WORK_STATUSES,
  WORK_STATUS_LABELS,
  dominantWorkStatus,
} from '@/lib/work-status'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { cn } from '@/lib/utils'
import { isVoided, isOverdue } from '@/lib/invoice-status'
import type { InvoiceListRow } from '@/data/invoices'


export function InvoiceListClient({ invoices }: { invoices: InvoiceListRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [workFilter, setWorkFilter] = useState<'all' | WorkStatus>('all')
  const today = todayISODate()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return invoices.filter(inv => {
      const matchSearch =
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customers?.clinic_name ?? '').toLowerCase().includes(q)
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'void' ? isVoided(inv) :
        statusFilter === 'overdue' ? isOverdue(inv, today) :
        (!isVoided(inv) && inv.status === statusFilter)
      const matchWork =
        workFilter === 'all' ||
        (inv.invoice_items ?? []).some(it => it.work_status === workFilter)
      return matchSearch && matchStatus && matchWork
    })
  }, [search, statusFilter, workFilter, invoices, today])

  const columns: Column<InvoiceListRow>[] = [
    { key: 'number', header: 'Invoice #', cell: inv => <span className="font-medium text-primary">{inv.invoice_number}</span> },
    { key: 'customer', header: 'Customer', cell: inv => <span className="text-gray-700">{inv.customers?.clinic_name ?? '—'}</span> },
    { key: 'patient', header: 'Patient', cell: inv => <span className="text-gray-700">{inv.patient ?? '—'}</span> },
    { key: 'date', header: 'Date', cell: inv => <span className="text-sm text-gray-500">{formatDate(inv.invoice_date)}</span> },
    { key: 'due', header: 'Due Date', cell: inv => <span className="text-sm text-gray-500">{formatDate(inv.due_date)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: inv => <span className="font-medium tabular-nums">{formatCurrency(inv.total)}</span> },
    {
      key: 'payment',
      header: 'Payment',
      cell: inv =>
        isVoided(inv) ? (
          <Badge variant="destructive" className="uppercase">Voided</Badge>
        ) : isOverdue(inv, today) ? (
          <Badge variant="destructive" className="capitalize">Overdue</Badge>
        ) : (
          <Badge variant={statusBadgeVariant('payment', inv.status)} className="capitalize">{inv.status}</Badge>
        ),
    },
    {
      key: 'work',
      header: 'Work',
      cell: inv => {
        const dominant = dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status))
        return dominant ? <WorkStatusBadge status={dominant} /> : <span className="text-xs text-gray-400">—</span>
      },
    },
    {
      key: 'service',
      header: 'Service',
      cell: inv =>
        inv.service_statuses ? (
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', inv.service_statuses.color ?? DEFAULT_COLOR)}>
            {inv.service_statuses.label}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
  ]

  const hasQuery = search.trim() !== '' || statusFilter !== 'all' || workFilter !== 'all'
  const view = listViewState({ loading: false, total: invoices.length, filtered: filtered.length, hasQuery })
  const emptyState = (
    <EmptyState
      icon={<FileText className="h-8 w-8" />}
      title={view === 'empty-no-results' ? 'No invoices match your filters' : 'No invoices yet'}
      description={view === 'empty-no-results' ? 'Try a different search or filter.' : 'Create your first invoice to get started.'}
    />
  )

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
            <SelectItem value="void">Voided</SelectItem>
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
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={inv => inv.id}
            onRowClick={inv => router.push(`/invoices/${inv.id}`)}
            empty={emptyState}
          />
        </CardContent>
      </Card>
    </div>
  )
}
