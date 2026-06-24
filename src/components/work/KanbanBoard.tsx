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

import { useMemo, useOptimistic, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import { cn } from '@/lib/utils'
import { WORK_STATUSES } from '@/lib/work-status'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import { updateWorkStatusAction } from '@/data/invoice-actions'
import { WorkStageChips } from '@/components/work/WorkStageChips'
import { WorkStatusSelect, ADVANCE_VALUE } from '@/components/work-status-select'
import { decodeWork, encodeWork, nextWorkStep } from '@/lib/work-stages'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
import type { WorkQueueRow } from '@/data/work'

// ─── Optimistic state ───────────────────────────────────────────────────────

type OptimisticItemMove = { id: string; work_status: WorkStatus; stage_id: string | null }

function applyOptimisticMove(rows: WorkQueueRow[], move: OptimisticItemMove): WorkQueueRow[] {
  return rows.map(r =>
    r.id === move.id ? { ...r, work_status: move.work_status, stage_id: move.stage_id } : r,
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ItemCard({
  row,
  activeStages,
  stagesById,
  statusConfigs,
  onDragStart,
  onClick,
  onStatusChange,
}: {
  row: WorkQueueRow
  activeStages: WorkStage[]
  stagesById: Map<string, WorkStage>
  statusConfigs: WorkStatusDisplay[]
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onClick: (invoiceId: string | undefined) => void
  onStatusChange: (row: WorkQueueRow, value: string) => void
}) {
  const isInProgress = row.work_status === 'in_progress'

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
      <div className="font-semibold text-foreground text-sm leading-snug">{row.description}</div>
      <div className="text-xs text-muted-foreground mt-1 truncate">
        {row.invoices?.customers?.clinic_name ?? '—'}
        {row.invoices?.patient && ` · ${row.invoices.patient}`}
      </div>

      {/* In-progress sub-stage: stepper when on a stage, Set-stage prompt when not. */}
      {isInProgress && (
        <div className="mt-2" onClick={e => e.stopPropagation()}>
          {row.stage_id ? (
            <WorkStageChips activeStages={activeStages} workStatus={row.work_status} stageId={row.stage_id} statusConfigs={statusConfigs} onSelect={stageId => onStatusChange(row, `stage:${stageId}`)} />
          ) : (
            <WorkStatusSelect
              value={encodeWork(row.work_status, row.stage_id)}
              onValueChange={v => onStatusChange(row, v)}
              activeStages={activeStages}
              workStatus={row.work_status}
              stageId={row.stage_id}
              stagesById={stagesById}
              statusConfigs={statusConfigs}
              triggerClassName="h-8 w-full text-xs"
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs font-mono text-muted-foreground">{row.invoices?.invoice_number ?? '—'}</span>
      </div>
    </div>
  )
}

function KanbanColumn({
  status,
  rows,
  activeStages,
  stagesById,
  onDragStart,
  onDrop,
  onCardClick,
  statusConfigs,
  onStatusChange,
}: {
  status: WorkStatus
  rows: WorkQueueRow[]
  activeStages: WorkStage[]
  stagesById: Map<string, WorkStage>
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onDrop: (e: React.DragEvent, targetStatus: WorkStatus) => void
  onCardClick: (invoiceId: string | undefined) => void
  statusConfigs: WorkStatusDisplay[]
  onStatusChange: (row: WorkQueueRow, value: string) => void
}) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  return (
    <div
      className="flex w-[min(18rem,82vw)] shrink-0 flex-col sm:w-72"
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
            activeStages={activeStages}
            stagesById={stagesById}
            statusConfigs={statusConfigs}
            onDragStart={onDragStart}
            onClick={onCardClick}
            onStatusChange={onStatusChange}
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

export function KanbanBoard({ rows, stages, statusConfigs }: { rows: WorkQueueRow[]; stages: WorkStage[]; statusConfigs: WorkStatusDisplay[] }) {
  const router = useRouter()
  const { show } = useToast()
  const [, startTransition] = useTransition()

  const [optimisticRows, applyOptimistic] = useOptimistic(
    rows,
    applyOptimisticMove,
  )

  const stagesById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])
  const activeStages = useMemo(() => stages.filter(s => s.is_active), [stages])

  // "Done" (delivered) is the terminal state — its column is hidden by default so
  // completed work doesn't pile up and lengthen the board. A toggle reveals it.
  const [showDone, setShowDone] = useState(false)

  // Group items into columns by their own work status.
  const rowsByStatus = useMemo(() => {
    const map = new Map<WorkStatus, WorkQueueRow[]>()
    for (const s of WORK_STATUSES) map.set(s, [])
    for (const r of optimisticRows) {
      map.get(r.work_status)?.push(r)
    }
    return map
  }, [optimisticRows])

  // Apply a (work_status, stage_id) move for one item: optimistic + server.
  const applyMove = (itemId: string, work_status: WorkStatus, stage_id: string | null) => {
    startTransition(async () => {
      applyOptimistic({ id: itemId, work_status, stage_id })
      const res = await updateWorkStatusAction(itemId, { work_status, stage_id })
      if (res.ok === false) show({ variant: 'error', title: res.error })
      router.refresh()
    })
  }

  // Set-stage dropdown change on a card (resolves Advance + Resume-less sentinels).
  const onCardStatusChange = (row: WorkQueueRow, value: string) => {
    const resolved = value === ADVANCE_VALUE
      ? nextWorkStep(row.work_status)
      : decodeWork(value)
    if (!resolved) return
    applyMove(row.id, resolved.work_status, resolved.stage_id)
  }

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
      applyOptimistic({ id: itemId, work_status: targetStatus, stage_id: null })
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

  const doneCount = rowsByStatus.get('delivered')?.length ?? 0
  const columns = showDone ? WORK_STATUSES : WORK_STATUSES.filter(s => s !== 'delivered')

  return (
    <div className="space-y-2">
      <div className="flex justify-end px-4 sm:px-0">
        <button
          type="button"
          onClick={() => setShowDone(v => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          {showDone ? 'Hide done' : `Show done${doneCount ? ` (${doneCount})` : ''}`}
        </button>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        <div className="flex gap-4 min-w-max">
          {columns.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              rows={rowsByStatus.get(status) ?? []}
              activeStages={activeStages}
              stagesById={stagesById}
              statusConfigs={statusConfigs}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onCardClick={handleCardClick}
              onStatusChange={onCardStatusChange}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
