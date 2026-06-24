'use client'

// Thin client wrapper for the Work page that owns the List/Board toggle.
// Receives the same rows/stages from the server component; no fetching here.

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { KanbanBoard } from '@/components/work/KanbanBoard'
import { WorkQueueClient } from '@/components/work/WorkQueueClient'
import type { WorkStage, WorkStatusConfig } from '@/lib/database.types'
import type { WorkQueueRow } from '@/data/work'

type ViewMode = 'board' | 'list'

export function WorkViewToggle({
  rows,
  stages,
  statusConfigs,
}: {
  rows: WorkQueueRow[]
  stages: WorkStage[]
  statusConfigs: WorkStatusConfig[]
}) {
  const [view, setView] = useState<ViewMode>('list')

  return (
    <div className="space-y-6">
      {/* Page header + view toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Work</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} item{rows.length === 1 ? '' : 's'} across all invoices
          </p>
        </div>

        {/* List | Board toggle */}
        <div className="grid w-full grid-cols-2 overflow-hidden rounded-lg border border-border text-sm sm:flex sm:w-auto sm:items-center">
          <ToggleButton
            active={view === 'list'}
            onClick={() => setView('list')}
            label="List"
          />
          <ToggleButton
            active={view === 'board'}
            onClick={() => setView('board')}
            label="Board"
          />
        </div>
      </div>

      {/* View */}
      {view === 'board' ? (
        <KanbanBoard rows={rows} stages={stages} statusConfigs={statusConfigs} />
      ) : (
        <WorkQueueClient rows={rows} stages={stages} statusConfigs={statusConfigs} hideHeader />
      )}
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-background text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  )
}
