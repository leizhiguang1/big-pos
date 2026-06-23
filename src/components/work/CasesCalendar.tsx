'use client'

// Calendar view for the Work page. Lays out CASES (invoices) on a month grid by
// their `due_date`. Each day cell lists the cases due that day (invoice #, clinic,
// patient, dominant WorkStatusBadge); clicking a case navigates to its invoice.
//
// Dependency-free: the month grid is built with plain Date math (no calendar npm
// package). Cases with no due_date drop into a "No due date" bucket below the grid.
//
// Grouping mirrors KanbanBoard: rows are grouped by invoices.id into cases, and a
// case's badge uses dominantWorkStatus(item work_statuses).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn, todayISODate } from '@/lib/utils'
import { dominantWorkStatus } from '@/lib/work-status'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { WorkStatus } from '@/lib/database.types'
import type { WorkQueueRow } from '@/data/work'

// ─── Case grouping ──────────────────────────────────────────────────────────

type CalendarCase = {
  invoiceId: string
  invoiceNumber: string
  clinicName: string
  patient: string | null
  dueDate: string | null
  dominant: WorkStatus
}

function groupIntoCases(rows: WorkQueueRow[]): CalendarCase[] {
  const map = new Map<string, { meta: Omit<CalendarCase, 'dominant'>; statuses: WorkStatus[] }>()
  for (const row of rows) {
    if (!row.invoices) continue
    const { id: invoiceId, invoice_number, patient, due_date } = row.invoices
    const clinicName = row.invoices.customers?.clinic_name ?? '—'
    if (!map.has(invoiceId)) {
      map.set(invoiceId, {
        meta: {
          invoiceId,
          invoiceNumber: invoice_number,
          clinicName,
          patient: patient ?? null,
          dueDate: due_date ?? null,
        },
        statuses: [],
      })
    }
    map.get(invoiceId)!.statuses.push(row.work_status)
  }

  const cases: CalendarCase[] = []
  for (const { meta, statuses } of map.values()) {
    const dominant = dominantWorkStatus(statuses)
    if (dominant !== null) cases.push({ ...meta, dominant })
  }
  return cases
}

// ─── Month grid date math ────────────────────────────────────────────────────

// Local `yyyy-MM-dd` key for a Date (matches todayISODate's local-calendar logic).
function isoDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// All days that appear on the month grid, padded to whole weeks (Mon-start).
// Each cell knows whether it belongs to the focused month so trailing/leading
// days render muted.
function buildMonthDays(year: number, month: number): Array<{ date: Date; inMonth: boolean }> {
  const first = new Date(year, month, 1)
  // JS getDay() is 0=Sun..6=Sat; shift so Monday is the first column.
  const leadingBlanks = (first.getDay() + 6) % 7

  const days: Array<{ date: Date; inMonth: boolean }> = []
  // Leading days from the previous month.
  for (let i = leadingBlanks; i > 0; i--) {
    days.push({ date: new Date(year, month, 1 - i), inMonth: false })
  }
  // Days of the focused month.
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), inMonth: true })
  }
  // Trailing days to complete the final week.
  while (days.length % 7 !== 0) {
    const next = days.length - (leadingBlanks + daysInMonth) + 1
    days.push({ date: new Date(year, month + 1, next), inMonth: false })
  }
  return days
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function CaseChip({ kase, onClick }: { kase: CalendarCase; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md border border-border bg-card px-1.5 py-1 text-left',
        'hover:shadow-sm transition-shadow',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] text-muted-foreground truncate">{kase.invoiceNumber}</span>
        <WorkStatusBadge status={kase.dominant} className="px-1.5 py-0 text-[10px]" />
      </div>
      <div className="text-[11px] font-medium text-foreground leading-tight truncate">{kase.clinicName}</div>
      {kase.patient && (
        <div className="text-[10px] text-muted-foreground leading-tight truncate">{kase.patient}</div>
      )}
    </button>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CasesCalendar({ rows }: { rows: WorkQueueRow[] }) {
  const router = useRouter()
  const today = todayISODate()

  const cases = useMemo(() => groupIntoCases(rows), [rows])

  // Cases bucketed by due_date key; cases without a due_date go to a side bucket.
  const { byDay, noDueDate } = useMemo(() => {
    const byDay = new Map<string, CalendarCase[]>()
    const noDueDate: CalendarCase[] = []
    for (const c of cases) {
      if (!c.dueDate) {
        noDueDate.push(c)
        continue
      }
      const list = byDay.get(c.dueDate) ?? []
      list.push(c)
      byDay.set(c.dueDate, list)
    }
    return { byDay, noDueDate }
  }, [cases])

  // Focused month — initialized to the current month.
  const now = new Date()
  const [view, setView] = useState<{ year: number; month: number }>({
    year: now.getFullYear(),
    month: now.getMonth(),
  })

  const days = useMemo(() => buildMonthDays(view.year, view.month), [view])

  const goToPrevMonth = () =>
    setView(v => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }))
  const goToNextMonth = () =>
    setView(v => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }))
  const goToToday = () => setView({ year: now.getFullYear(), month: now.getMonth() })

  const openCase = (invoiceId: string) => router.push(`/invoices/${invoiceId}`)

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToPrevMonth}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-foreground ml-1">
            {MONTH_NAMES[view.month]} {view.year}
          </h2>
        </div>
        <button
          type="button"
          onClick={goToToday}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Today
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px rounded-t-lg border border-b-0 border-border bg-muted/50 text-center">
        {WEEKDAYS.map(d => (
          <div key={d} className="px-2 py-2 text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-px -mt-4 rounded-b-lg border border-border bg-border overflow-hidden">
        {days.map(({ date, inMonth }) => {
          const key = isoDateKey(date)
          const isToday = key === today
          const dayCases = byDay.get(key) ?? []
          return (
            <div
              key={key}
              className={cn(
                'min-h-28 bg-card p-1.5 flex flex-col gap-1',
                !inMonth && 'bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs',
                    isToday
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : inMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  {date.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {dayCases.map(c => (
                  <CaseChip key={c.invoiceId} kase={c} onClick={() => openCase(c.invoiceId)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* No-due-date bucket */}
      {noDueDate.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            No due date <span className="text-muted-foreground font-normal">({noDueDate.length})</span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {noDueDate.map(c => (
              <CaseChip key={c.invoiceId} kase={c} onClick={() => openCase(c.invoiceId)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
