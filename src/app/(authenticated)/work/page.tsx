'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Search, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
import {
  WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_FILLED, WORK_STATUS_OUTLINED,
} from '@/lib/work-status'
import {
  fetchWorkStages, encodeWork, decodeWork, workOptionsForItem,
  labelForValue, colorForValue, orderedGroupKeys,
} from '@/lib/work-stages'

type Row = {
  id: string
  description: string
  work_status: WorkStatus
  stage_id: string | null
  work_status_updated_at: string
  invoices: {
    id: string
    invoice_number: string
    status: string
    voided_at: string | null
    customers: { clinic_name: string } | null
  } | null
}

type FilterMode = 'active' | 'all' | WorkStatus

// Outlined/filled palettes for the meta chips so they follow the same
// "color = stage" rule as the per-status chips.
const META_CHIP_OUTLINED: Record<'active' | 'all', string> = {
  active: 'bg-white border border-primary text-primary',
  all:    'bg-white border border-slate-400 text-slate-700',
}
const META_CHIP_FILLED: Record<'active' | 'all', string> = {
  active: 'bg-primary text-primary-foreground border border-primary',
  all:    'bg-slate-700 text-white border border-slate-700',
}

const MOVE_HINT_MS = 4000

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// A small pill used for group headers and the "moved to" hint, colored by slot.
function SlotBadge({ value, stagesById, className }: {
  value: string
  stagesById: Map<string, WorkStage>
  className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      colorForValue(value, stagesById),
      className,
    )}>
      {labelForValue(value, stagesById)}
    </span>
  )
}

export default function WorkPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [stages, setStages] = useState<WorkStage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('active')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Items recently changed → shown briefly with a "moved to X" hint even if they
  // no longer match the current filter. Maps item id → new slot value. Cleared
  // after MOVE_HINT_MS.
  const [recentlyMoved, setRecentlyMoved] = useState<Map<string, string>>(new Map())

  const load = async () => {
    const [{ data }, stageRows] = await Promise.all([
      supabase
        .from('invoice_items')
        .select('id, description, work_status, stage_id, work_status_updated_at, invoices(id, invoice_number, status, voided_at, customers(clinic_name))')
        .order('work_status_updated_at', { ascending: false })
        .order('id', { ascending: true }),
      fetchWorkStages(),
    ])
    const items = ((data ?? []) as unknown as Row[]).filter(r => r.invoices && r.invoices.voided_at == null)
    setRows(items)
    setStages(stageRows)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const allStagesById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])
  const activeStages = useMemo(() => stages.filter(s => s.is_active), [stages])

  // Optimistic local updates — no refetch, so the row stays put visually.
  const updateStatus = async (id: string, value: string) => {
    const { work_status, stage_id } = decodeWork(value)
    setRows(prev => prev.map(r =>
      r.id === id
        ? { ...r, work_status, stage_id, work_status_updated_at: new Date().toISOString() }
        : r
    ))
    setRecentlyMoved(prev => {
      const n = new Map(prev)
      n.set(id, value)
      return n
    })
    setTimeout(() => {
      setRecentlyMoved(prev => {
        if (!prev.has(id)) return prev
        const n = new Map(prev)
        n.delete(id)
        return n
      })
    }, MOVE_HINT_MS)
    // The DB trigger logs history + stamps the timestamp; we only write the change.
    await supabase.from('invoice_items').update({ work_status, stage_id }).eq('id', id)
  }

  const toggleCollapsed = (key: string) => {
    setCollapsed(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  // counts across all rows, per phase (chips stay phase-level)
  const counts = useMemo(() => {
    const c: Record<WorkStatus, number> = {
      received: 0, in_progress: 0, ready: 0, delivered: 0, on_hold: 0,
    }
    for (const r of rows) c[r.work_status]++
    return c
  }, [rows])

  const activeCount = useMemo(
    () => rows.filter(r => r.work_status !== 'delivered').length,
    [rows]
  )

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim()
    return rows.filter(r => {
      const isRecentlyMoved = recentlyMoved.has(r.id)
      // Stage filter — recently-moved rows bypass it so the user sees confirmation
      if (!isRecentlyMoved) {
        if (filter === 'active' && r.work_status === 'delivered') return false
        if (filter !== 'active' && filter !== 'all' && r.work_status !== filter) return false
      }
      if (!q) return true
      return (
        r.description.toLowerCase().includes(q) ||
        (r.invoices?.invoice_number.toLowerCase().includes(q) ?? false) ||
        (r.invoices?.customers?.clinic_name.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, filter, search, recentlyMoved])

  // Group items by their encoded slot (received / stage:<id> / in_progress / ready / …),
  // ordered canonically with any inactive-stage groups slotted into the In-Progress region.
  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>()
    for (const r of visible) {
      const key = encodeWork(r.work_status, r.stage_id)
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(r)
    }
    const order = orderedGroupKeys(activeStages, [...g.keys()])
    return order.map(key => ({ key, items: g.get(key)! }))
  }, [visible, activeStages])

  const chips: Array<{ key: FilterMode; label: string; count: number }> = [
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'all', label: 'All', count: rows.length },
    ...WORK_STATUSES.map(s => ({ key: s as FilterMode, label: WORK_STATUS_LABELS[s], count: counts[s] })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Work Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {activeCount} active item{activeCount === 1 ? '' : 's'} across all invoices
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map(c => {
          const stageKey = c.key !== 'active' && c.key !== 'all' ? (c.key as WorkStatus) : null
          const isSelected = filter === c.key
          const filled = stageKey ? WORK_STATUS_FILLED[stageKey] : META_CHIP_FILLED[c.key as 'active' | 'all']
          const outlined = stageKey ? WORK_STATUS_OUTLINED[stageKey] : META_CHIP_OUTLINED[c.key as 'active' | 'all']
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                isSelected ? filled : cn(outlined, 'hover:bg-gray-50'),
              )}
            >
              {c.label}
              <span className={cn(
                'inline-flex items-center justify-center min-w-[18px] h-4 rounded-full px-1 text-[10px] font-semibold',
                isSelected ? 'bg-white/25' : 'bg-gray-100 text-gray-600',
              )}>
                {c.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search item, invoice, customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading && (
        <Card><CardContent className="py-10 text-center text-gray-400">Loading…</CardContent></Card>
      )}

      {!loading && grouped.length === 0 && (
        <Card><CardContent className="py-10 text-center text-gray-400">No items.</CardContent></Card>
      )}

      <div className="space-y-4">
        {grouped.map(group => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <Card key={group.key} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCollapsed(group.key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 border-b"
              >
                <div className="flex items-center gap-3">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  <SlotBadge value={group.key} stagesById={allStagesById} />
                  <span className="text-sm text-gray-500">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                </div>
              </button>
              {!isCollapsed && (
                <div className="divide-y">
                  {group.items.map(row => {
                    const movedTo = recentlyMoved.get(row.id)
                    const isMoved = movedTo !== undefined
                    const currentValue = encodeWork(row.work_status, row.stage_id)
                    const options = workOptionsForItem(activeStages, row.work_status, row.stage_id, allStagesById)
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 transition-colors',
                          isMoved && 'bg-green-50/60'
                        )}
                      >
                        <div className="md:w-48 min-w-0">
                          <Link
                            href={`/invoices/${row.invoices?.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {row.invoices?.invoice_number ?? '—'}
                          </Link>
                          <div className="text-xs text-gray-500 truncate">
                            {row.invoices?.customers?.clinic_name ?? '—'}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 truncate">{row.description}</div>
                          {isMoved ? (
                            <div className="text-xs text-green-700 mt-0.5 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Moved to <SlotBadge value={movedTo!} stagesById={allStagesById} className="ml-0.5" />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 mt-0.5">{relativeTime(row.work_status_updated_at)}</div>
                          )}
                        </div>

                        <Select value={currentValue} onValueChange={v => updateStatus(row.id, v)}>
                          <SelectTrigger
                            className={cn(
                              'h-8 w-40 text-xs font-medium border-transparent',
                              colorForValue(currentValue, allStagesById)
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
