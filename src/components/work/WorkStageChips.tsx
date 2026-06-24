'use client'

// Renders the active in-progress stages as a row of EQUAL chips: only the
// current sub-status is highlighted (its stage color); every other stage looks
// the same muted pill, regardless of order. There is deliberately no connector
// line, no "done" fill, and no "X of N" count — a stage is a labeled sub-status
// of In Progress, not a step in a sequence. Renders nothing unless in_progress.
// A bare in-progress item (or one on a retired stage) shows all chips muted with
// an "In Progress" caption.
//
// When `onSelect` is provided the chips become interactive buttons: clicking a
// NON-current chip sets that sub-status; clicking the current chip is a no-op
// (clearing back to "no sub-status" is done from the dropdown). Without
// `onSelect` the chips are plain display-only labels.

import { cn } from '@/lib/utils'
import { STAGE_DEFAULT_COLOR } from '@/lib/work-stages'
import { workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

export function WorkStageChips({
  activeStages,
  workStatus,
  stageId,
  statusConfigs,
  onSelect,
}: {
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
  statusConfigs?: WorkStatusDisplay[]
  // Called with the clicked stage's id when a non-current chip is picked.
  onSelect?: (stageId: string) => void
}) {
  if (workStatus !== 'in_progress' || activeStages.length === 0) return null

  const interactive = !!onSelect

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {activeStages.map(stage => {
          const current = stage.id === stageId
          const pill = cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
            current ? (stage.color ?? STAGE_DEFAULT_COLOR) : 'bg-gray-100 text-gray-500',
          )
          if (!interactive) {
            return (
              <span key={stage.id} title={stage.label} className={pill}>
                {stage.label}
              </span>
            )
          }
          return (
            <button
              key={stage.id}
              type="button"
              title={current ? stage.label : `Set sub-status: ${stage.label}`}
              aria-pressed={current}
              disabled={current}
              onClick={e => {
                // Don't let the click bubble to the card (which navigates) or
                // trigger drag handlers on the parent.
                e.stopPropagation()
                if (!current) onSelect!(stage.id)
              }}
              className={cn(
                pill,
                current
                  ? 'cursor-default'
                  : 'cursor-pointer hover:bg-gray-200 hover:text-gray-700 transition-colors',
              )}
            >
              {stage.label}
            </button>
          )
        })}
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">{workStatusLabel('in_progress', statusConfigs)}</p>
    </div>
  )
}
