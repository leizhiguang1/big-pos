'use client'

// Shared work-status dropdown: a colored trigger pill plus grouped options with
// a color dot per option. The four configurable stages sit under an
// "In Progress" group header. Used by the invoice-detail Work Status card and
// the work queue so both render identically.

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  encodeWork, workColor, workLabel, dotColorClass, STAGE_DEFAULT_COLOR, type WorkOption,
} from '@/lib/work-stages'
import { WORK_STATUS_LABELS, WORK_STATUS_COLORS } from '@/lib/work-status'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

function Dot({ color }: { color: string }) {
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', dotColorClass(color))} />
}

function OptionRow({ option }: { option: WorkOption }) {
  return (
    <span className="flex items-center gap-2">
      <Dot color={option.color} />
      {option.label}
    </span>
  )
}

const fixed = (status: WorkStatus): WorkOption => ({
  value: status,
  label: WORK_STATUS_LABELS[status],
  color: WORK_STATUS_COLORS[status],
})

export function WorkStatusSelect({
  value,
  onValueChange,
  activeStages,
  workStatus,
  stageId,
  stagesById,
  triggerClassName,
  leadingItems,
}: {
  value: string
  onValueChange: (value: string) => void
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
  stagesById: Map<string, WorkStage>
  triggerClassName?: string
  // Extra action items rendered above "Received" (e.g. the work queue's
  // "Resume" option for on-hold cards). Plain label, no color dot.
  leadingItems?: { value: string; label: string }[]
}) {
  // In-Progress group: the active stages, plus the item's current value when it
  // sits on a retired stage / bare in-progress (so it stays selectable + visible).
  const inProgress: WorkOption[] = activeStages.map(s => ({
    value: `stage:${s.id}`,
    label: s.label,
    color: s.color ?? STAGE_DEFAULT_COLOR,
  }))
  const current = encodeWork(workStatus, stageId)
  const isInProgressValue = current === 'in_progress' || current.startsWith('stage:')
  if (isInProgressValue && !inProgress.some(o => o.value === current)) {
    inProgress.unshift({
      value: current,
      label: workLabel(workStatus, stageId, stagesById),
      color: workColor(workStatus, stageId, stagesById),
    })
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          'h-8 w-44 text-xs font-medium border-transparent',
          workColor(workStatus, stageId, stagesById),
          triggerClassName,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {leadingItems && leadingItems.length > 0 && (
          <>
            {leadingItems.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
            <SelectSeparator />
          </>
        )}
        <SelectItem value="received"><OptionRow option={fixed('received')} /></SelectItem>
        <SelectGroup>
          <SelectLabel>In Progress</SelectLabel>
          {inProgress.map(o => (
            <SelectItem key={o.value} value={o.value}><OptionRow option={o} /></SelectItem>
          ))}
        </SelectGroup>
        <SelectItem value="ready"><OptionRow option={fixed('ready')} /></SelectItem>
        <SelectItem value="delivered"><OptionRow option={fixed('delivered')} /></SelectItem>
        <SelectItem value="on_hold"><OptionRow option={fixed('on_hold')} /></SelectItem>
      </SelectContent>
    </Select>
  )
}
