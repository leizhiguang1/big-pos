'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  FilePlus2, Send, Banknote, Coins, Ban, Trash2, RotateCcw, Pencil, Wrench,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { cn, formatRelativeTime, formatDateTime, formatCurrency } from '@/lib/utils'
import type { WorkStatus } from '@/lib/database.types'
import type { WorkStatusDisplay } from '@/lib/work-status-config'
import type { TimelineEvent } from '@/data/invoice-activity'

const WORK_STATUS_ACTION = 'work_status.changed'
const SHOW_WS_KEY = 'invoiceActivity.showWorkStatus'
const PAGE_SIZE = 8

// Actions whose field diffs are worth an expandable list (multi-field edits).
const EXPANDABLE = new Set(['invoice.edited', 'invoice.recipient_changed', 'invoice.case_changed'])

type Category = { icon: typeof FilePlus2; cls: string }
const CATEGORIES: Record<string, Category> = {
  created: { icon: FilePlus2, cls: 'bg-slate-100 text-slate-600' },
  issued: { icon: Send, cls: 'bg-blue-100 text-blue-600' },
  payment: { icon: Banknote, cls: 'bg-green-100 text-green-600' },
  credit: { icon: Coins, cls: 'bg-amber-100 text-amber-600' },
  void: { icon: Ban, cls: 'bg-red-100 text-red-600' },
  deleted: { icon: Trash2, cls: 'bg-red-100 text-red-600' },
  restored: { icon: RotateCcw, cls: 'bg-emerald-100 text-emerald-600' },
  edit: { icon: Pencil, cls: 'bg-violet-100 text-violet-600' },
  work: { icon: Wrench, cls: 'bg-cyan-100 text-cyan-600' },
}

function categoryOf(action: string): Category {
  switch (action) {
    case 'invoice.created': return CATEGORIES.created
    case 'invoice.issued': return CATEGORIES.issued
    case 'payment.recorded': return CATEGORIES.payment
    case 'credit.recorded': return CATEGORIES.credit
    case 'invoice.voided': return CATEGORIES.void
    case 'invoice.soft_deleted':
    case 'invoice.purged': return CATEGORIES.deleted
    case 'invoice.restored':
    case 'invoice.void_restored': return CATEGORIES.restored
    case WORK_STATUS_ACTION: return CATEGORIES.work
    default: return CATEGORIES.edit
  }
}

function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
function money(v: unknown): string {
  return formatCurrency(Number(v ?? 0))
}
function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}
function fromToText(c: { from: unknown; to: unknown } | undefined): ReactNode {
  if (!c) return null
  return c.from
    ? <>from <Strong>{valueText(c.from)}</Strong> → <Strong>{valueText(c.to)}</Strong></>
    : <>to <Strong>{valueText(c.to)}</Strong></>
}

// Plain-language predicate (with key values highlighted) that follows the actor name.
function describe(e: TimelineEvent, statusConfigs?: WorkStatusDisplay[]): ReactNode {
  const m = (e.metadata ?? {}) as Record<string, unknown>
  const c0 = Array.isArray(e.changes) ? e.changes[0] : undefined
  switch (e.action) {
    case 'invoice.created': return <>created invoice{m.status ? <> ({String(m.status)})</> : null}</>
    case 'invoice.issued': return <>issued invoice</>
    case 'payment.recorded': return <>recorded payment of <Strong>{money(m.amount)}</Strong>{m.reference_number ? <> · ref {String(m.reference_number)}</> : null}</>
    case 'credit.recorded': return <>issued <Strong>{money(m.amount)}</Strong> credit{m.reason ? <> ({String(m.reason)})</> : null}</>
    case 'invoice.voided': return <>voided invoice</>
    case 'invoice.soft_deleted': return <>deleted invoice</>
    case 'invoice.restored': return <>restored invoice</>
    case 'invoice.void_restored': return <>restored the voided invoice</>
    case 'invoice.purged': return <>permanently deleted invoice</>
    case 'invoice.work_note_changed': return <>updated work note{m.item ? <> on <Strong>{String(m.item)}</Strong></> : null}</>
    case 'invoice.service_status_changed': return <>changed service status {fromToText(c0)}</>
    case WORK_STATUS_ACTION: {
      const from = m.fromStatus as WorkStatus | null | undefined
      const to = m.toStatus as WorkStatus | undefined
      return (
        <>
          changed work status{m.item ? <> of <Strong>{String(m.item)}</Strong></> : null}{' '}
          {from ? <>from <WorkStatusBadge status={from} statusConfigs={statusConfigs} /> → </> : <>to </>}
          {to ? <WorkStatusBadge status={to} statusConfigs={statusConfigs} /> : null}
        </>
      )
    }
    case 'invoice.case_changed': return <>updated case details</>
    case 'invoice.recipient_changed': return <>updated recipient details</>
    case 'invoice.edited': {
      const it = m.items as { added?: number; removed?: number } | undefined
      const parts: string[] = []
      if (it?.added) parts.push(`${it.added} item${it.added > 1 ? 's' : ''} added`)
      if (it?.removed) parts.push(`${it.removed} item${it.removed > 1 ? 's' : ''} removed`)
      return <>edited the invoice{parts.length ? <> ({parts.join(', ')})</> : null}</>
    }
    default: return e.action
  }
}

export function InvoiceActivityPanel({
  events,
  statusConfigs,
}: {
  events: TimelineEvent[]
  statusConfigs?: WorkStatusDisplay[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [showWorkStatus, setShowWorkStatus] = useState(false)
  const [page, setPage] = useState(1)

  // Restore the persisted preference after mount (default stays hidden for SSR).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(SHOW_WS_KEY) === '1') {
      setShowWorkStatus(true)
    }
  }, [])

  function toggleWorkStatus(next: boolean) {
    setShowWorkStatus(next)
    setPage(1)
    if (typeof window !== 'undefined') window.localStorage.setItem(SHOW_WS_KEY, next ? '1' : '0')
  }

  const workStatusCount = events.filter(e => e.action === WORK_STATUS_ACTION).length
  const visible = showWorkStatus ? events : events.filter(e => e.action !== WORK_STATUS_ACTION)
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))

  // Keep the page in range if the visible set shrinks (e.g. after hiding work status).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  if (events.length === 0) return null

  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const shown = visible.slice(start, start + PAGE_SIZE)

  return (
    <Card className="print:hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Activity</CardTitle>
          <p className="text-xs text-muted-foreground">Who did what on this invoice. Internal only — not printed.</p>
        </div>
        {workStatusCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-pressed={showWorkStatus}
            onClick={() => toggleWorkStatus(!showWorkStatus)}
          >
            {showWorkStatus ? 'Hide' : 'Show'} work status ({workStatusCount})
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">
            Only work-status changes so far — toggle “Show work status” to see them.
          </p>
        ) : (
          <>
            <ul className="divide-y">
              {shown.map(e => {
                const cat = categoryOf(e.action)
                const Icon = cat.icon
                const hasDiff = EXPANDABLE.has(e.action) && Array.isArray(e.changes) && e.changes.length > 0
                return (
                  <li key={e.id} className="flex gap-3 px-4 py-3 sm:px-5">
                    <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', cat.cls)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm">
                          <span className="font-medium text-foreground">{e.actorName}</span>{' '}
                          <span className="text-muted-foreground">{describe(e, statusConfigs)}</span>
                          {e.reason ? <span className="text-muted-foreground"> — {e.reason}</span> : null}
                        </p>
                        <time className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(e.at)}>
                          {formatRelativeTime(e.at)}
                        </time>
                      </div>
                      {hasDiff && (
                        <button
                          type="button"
                          className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {open === e.id ? 'Hide changes' : `${e.changes!.length} field${e.changes!.length > 1 ? 's' : ''} changed`}
                        </button>
                      )}
                      {hasDiff && open === e.id && (
                        <ul className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                          {e.changes!.map((c, i) => (
                            <li key={i} className="flex flex-wrap gap-1">
                              <span className="font-medium text-foreground">{c.label}:</span>
                              <span className="text-muted-foreground line-through">{valueText(c.from)}</span>
                              <span aria-hidden>→</span>
                              <span className="text-foreground">{valueText(c.to)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <Pagination
              className="border-t px-4 py-2.5 sm:px-5"
              page={safePage}
              totalPages={totalPages}
              filteredCount={visible.length}
              pageStart={start + 1}
              pageEnd={start + shown.length}
              onPageChange={setPage}
              itemLabel="events"
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
