'use client'

// Thin client wrapper for the Work page that owns the Board/List/Calendar toggle.
// Receives the same rows/stages from the server component; no fetching here.

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { KanbanBoard } from '@/components/work/KanbanBoard'
import { WorkQueueClient } from '@/components/work/WorkQueueClient'
import { CasesCalendar } from '@/components/work/CasesCalendar'
import type { WorkStage } from '@/lib/database.types'
import type { WorkQueueRow } from '@/data/work'

type ViewMode = 'board' | 'list' | 'calendar'

export function WorkViewToggle({ rows, stages }: { rows: WorkQueueRow[]; stages: WorkStage[] }) {
  const [view, setView] = useState<ViewMode>('board')

  return (
    <div className="space-y-6">
      {/* Page header + view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Work</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} item{rows.length === 1 ? '' : 's'} across all invoices
          </p>
        </div>

        {/* Board | List | Calendar toggle */}
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-sm">
          <ToggleButton
            active={view === 'board'}
            onClick={() => setView('board')}
            label="Board"
          />
          <ToggleButton
            active={view === 'list'}
            onClick={() => setView('list')}
            label="List"
          />
          <ToggleButton
            active={view === 'calendar'}
            onClick={() => setView('calendar')}
            label="Calendar"
          />
        </div>
      </div>

      {/* View */}
      {view === 'board' ? (
        <KanbanBoard rows={rows} />
      ) : view === 'calendar' ? (
        <CasesCalendar rows={rows} />
      ) : (
        <WorkQueueClient rows={rows} stages={stages} hideHeader />
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
