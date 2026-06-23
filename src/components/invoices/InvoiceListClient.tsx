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
import { FileText, Plus, Search } from 'lucide-react'
import { cn, formatCurrency, formatDate, todayISODate } from '@/lib/utils'
import {
  dominantWorkStatus,
} from '@/lib/work-status'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { isVoided, isOverdue } from '@/lib/invoice-status'
import type { InvoiceListRow } from '@/data/invoices'

type ViewKey = 'all' | 'drafts' | 'unpaid' | 'overdue' | 'in_production' | 'ready' | 'voided'

const VIEWS: { key: ViewKey; label: string; match: (inv: InvoiceListRow, today: string) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'drafts', label: 'Drafts', match: inv => !isVoided(inv) && inv.status === 'draft' },
  { key: 'unpaid', label: 'Awaiting payment', match: inv => !isVoided(inv) && ['sent', 'partial', 'overdue'].includes(inv.status) },
  { key: 'overdue', label: 'Overdue', match: (inv, today) => isOverdue(inv, today) },
  { key: 'in_production', label: 'In production', match: inv => {
      const d = dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status))
      return !isVoided(inv) && d != null && d !== 'ready' && d !== 'delivered'
    } },
  { key: 'ready', label: 'Ready to deliver', match: inv => dominantWorkStatus((inv.invoice_items ?? []).map(it => it.work_status)) === 'ready' },
  { key: 'voided', label: 'Voided', match: inv => isVoided(inv) },
]

export function InvoiceListClient({ invoices }: { invoices: InvoiceListRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [viewKey, setViewKey] = useState<ViewKey>('all')
  const today = todayISODate()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const view = VIEWS.find(v => v.key === viewKey) ?? VIEWS[0]
    return invoices.filter(inv => {
      const matchSearch =
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customers?.clinic_name ?? '').toLowerCase().includes(q) ||
        (inv.patient ?? '').toLowerCase().includes(q)
      return matchSearch && view.match(inv, today)
    })
  }, [search, viewKey, invoices, today])

  const columns: Column<InvoiceListRow>[] = [
    { key: 'number', header: 'Invoice #', cell: inv => <span className="font-medium text-primary">{inv.invoice_number}</span> },
    { key: 'customer', header: 'Clinic', cell: inv => <span className="text-muted-foreground">{inv.customers?.clinic_name ?? '—'}</span> },
    { key: 'patient', header: 'Patient', cell: inv => <span className="text-muted-foreground">{inv.patient ?? '—'}</span> },
    { key: 'date', header: 'Date', cell: inv => <span className="text-sm text-muted-foreground">{formatDate(inv.invoice_date)}</span> },
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
        return dominant ? <WorkStatusBadge status={dominant} /> : <span className="text-xs text-muted-foreground">—</span>
      },
    },
  ]

  const hasQuery = search.trim() !== '' || viewKey !== 'all'
  const viewState = listViewState({ loading: false, total: invoices.length, filtered: filtered.length, hasQuery })
  const activeViewLabel = VIEWS.find(v => v.key === viewKey)?.label ?? 'All'
  const emptyState = (
    <EmptyState
      icon={<FileText className="h-8 w-8" />}
      title={viewState === 'empty-no-results' ? `No invoices in "${activeViewLabel}"` : 'No invoices yet'}
      description={viewState === 'empty-no-results' ? 'Try a different search or view.' : 'Create your first invoice to get started.'}
    />
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices.length} total</p>
        </div>
        <Button asChild>
          <Link href="/invoices/new"><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {VIEWS.map(v => {
          const count = invoices.filter(inv => v.match(inv, today)).length
          const active = v.key === viewKey
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewKey(v.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {v.label}
              <span className={cn('ml-1.5 text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground/60')}>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search invoice #, clinic, or patient…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
