'use client'

// Kanban board for the Work page. Each card represents a SERVICE (one invoice
// line item); dragging a card to a column advances THAT item's work status only.
//
// Services on the same invoice move through stages independently (a crown can be
// Ready while a denture on the same invoice is still In Progress), so the board
// is per-item — matching the list view and the underlying invoice_items model.
//
// Column placement: a card sits in the column for its own item.work_status.
//
// DnD: native HTML5 drag-and-drop. onDragStart stashes the item id in
// dataTransfer; column drop handlers read it and call updateWorkStatusAction.
// Dropping into a status column clears the in-progress substage (stage_id=null);
// the coarse board only models the five top-level statuses.
//
// Optimistic UX: useOptimistic moves the card column immediately on drop; on
// action failure the state reverts and a toast appears. router.refresh() syncs
// the server state after either outcome.

import { useMemo, useOptimistic, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import { cn } from '@/lib/utils'
import { todayISODate } from '@/lib/utils'
import { WORK_STATUSES } from '@/lib/work-status'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import { updateWorkStatusAction } from '@/data/invoice-actions'
import type { WorkStatus } from '@/lib/database.types'
import type { WorkQueueRow } from '@/data/work'

// ─── Optimistic state ───────────────────────────────────────────────────────

type OptimisticItemMove = { id: string; work_status: WorkStatus }

function applyOptimisticMove(rows: WorkQueueRow[], move: OptimisticItemMove): WorkQueueRow[] {
  return rows.map(r =>
    r.id === move.id ? { ...r, work_status: move.work_status, stage_id: null } : r,
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ItemCard({
  row,
  today,
  onDragStart,
  onClick,
}: {
  row: WorkQueueRow
  today: string
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onClick: (invoiceId: string | undefined) => void
}) {
  const dueDate = row.invoices?.due_date ?? null
  const isPastDue = dueDate != null && dueDate < today && row.work_status !== 'delivered'

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, row.id)}
      onClick={() => onClick(row.invoices?.id)}
      className={cn(
        'bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing',
        'hover:shadow-md transition-shadow select-none',
      )}
    >
      {/* Service description — the card's subject */}
      <div className="font-semibold text-foreground text-sm leading-snug">
        {row.description}
      </div>

      {/* Clinic + patient */}
      <div className="text-xs text-muted-foreground mt-1 truncate">
        {row.invoices?.customers?.clinic_name ?? '—'}
        {row.invoices?.patient && ` · ${row.invoices.patient}`}
      </div>

      {/* Invoice # + due date */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs font-mono text-muted-foreground">
          {row.invoices?.invoice_number ?? '—'}
        </span>
        {dueDate && (
          <span className={cn('text-xs', isPastDue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
            Due {dueDate}
            {isPastDue && ' · overdue'}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({
  status,
  rows,
  today,
  onDragStart,
  onDrop,
  onCardClick,
  statusConfigs,
}: {
  status: WorkStatus
  rows: WorkQueueRow[]
  today: string
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onDrop: (e: React.DragEvent, targetStatus: WorkStatus) => void
  onCardClick: (invoiceId: string | undefined) => void
  statusConfigs: WorkStatusDisplay[]
}) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  return (
    <div
      className="flex flex-col w-72 shrink-0"
      onDragOver={handleDragOver}
      onDrop={e => onDrop(e, status)}
    >
      {/* Column header */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-t-lg border border-b-0 border-border',
        'bg-muted/50',
      )}>
        <span className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
          workStatusColor(status, statusConfigs),
        )}>
          {workStatusLabel(status, statusConfigs)}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length}</span>
      </div>

      {/* Cards area — scrolls vertically if many cards */}
      <div
        className={cn(
          'flex-1 min-h-32 flex flex-col gap-2 p-2',
          'rounded-b-lg border border-border bg-muted/20',
        )}
      >
        {rows.map(r => (
          <ItemCard
            key={r.id}
            row={r}
            today={today}
            onDragStart={onDragStart}
            onClick={onCardClick}
          />
        ))}
        {rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-6">
            No items
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function KanbanBoard({ rows, statusConfigs }: { rows: WorkQueueRow[]; statusConfigs: WorkStatusDisplay[] }) {
  const router = useRouter()
  const { show } = useToast()
  const [, startTransition] = useTransition()

  const today = todayISODate()

  const [optimisticRows, applyOptimistic] = useOptimistic(
    rows,
    applyOptimisticMove,
  )

  // Group items into columns by their own work status.
  const rowsByStatus = useMemo(() => {
    const map = new Map<WorkStatus, WorkQueueRow[]>()
    for (const s of WORK_STATUSES) map.set(s, [])
    for (const r of optimisticRows) {
      map.get(r.work_status)?.push(r)
    }
    return map
  }, [optimisticRows])

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetStatus: WorkStatus) => {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('text/plain')
    if (!itemId) return

    const row = optimisticRows.find(r => r.id === itemId)
    if (!row || row.work_status === targetStatus) return

    startTransition(async () => {
      applyOptimistic({ id: itemId, work_status: targetStatus })
      // Dropping into a status column resets the in-progress substage; the board
      // only models the five top-level statuses. resume_status is handled server-side.
      const res = await updateWorkStatusAction(itemId, { work_status: targetStatus, stage_id: null })
      if (res.ok === false) {
        show({ variant: 'error', title: res.error })
      }
      router.refresh()
    })
  }

  const handleCardClick = (invoiceId: string | undefined) => {
    if (invoiceId) router.push(`/invoices/${invoiceId}`)
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max">
        {WORK_STATUSES.map(status => (
          <KanbanColumn
            key={status}
            status={status}
            rows={rowsByStatus.get(status) ?? []}
            today={today}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onCardClick={handleCardClick}
            statusConfigs={statusConfigs}
          />
        ))}
      </div>
    </div>
  )
}
