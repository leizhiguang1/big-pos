'use client'

// Compact stepper showing how far an in-progress item has moved through the
// configured stages. Renders nothing unless the item is in_progress. A bare
// in-progress item or one sitting on a retired stage shows an indeterminate
// "In Progress" (all dots hollow).

import { cn } from '@/lib/utils'
import { stageProgress } from '@/lib/work-stages'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

export function WorkStageStepper({
  activeStages,
  workStatus,
  stageId,
}: {
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
}) {
  const progress = stageProgress(activeStages, workStatus, stageId)
  if (!progress || progress.total === 0) return null

  const { index, total } = progress

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        {activeStages.map((stage, i) => {
          const done = index >= 0 && i < index
          const current = i === index
          return (
            <div key={stage.id} className="flex items-center gap-1">
              {i > 0 && <span className={cn('h-px w-3', done || current ? 'bg-primary/60' : 'bg-gray-200')} />}
              <span
                title={stage.label}
                className={cn(
                  'h-2 w-2 rounded-full',
                  done && 'bg-primary',
                  current && 'bg-primary ring-2 ring-primary/25',
                  !done && !current && 'bg-gray-200',
                )}
              />
            </div>
          )
        })}
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        In Progress{index >= 0 ? ` · ${index + 1} of ${total}` : ''}
      </p>
    </div>
  )
}
