'use client'

// Shared work-status dropdown: a colored trigger pill plus colored option pills.
// Configurable stages sit under an "In Progress" group header. Used by the
// invoice-detail Work Status card and the work queue so both render identically.

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  encodeWork, workColor, workLabel, STAGE_DEFAULT_COLOR, type WorkOption,
} from '@/lib/work-stages'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

function OptionRow({ option }: { option: WorkOption }) {
  return (
    <span className={cn('inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-sm font-medium leading-5', option.color)}>
      <span className="truncate">{option.label}</span>
    </span>
  )
}

function WorkOptionItem({ option }: { option: WorkOption }) {
  return (
    <SelectItem value={option.value} textValue={option.label} className="py-2">
      <OptionRow option={option} />
    </SelectItem>
  )
}

const fixed = (status: WorkStatus, statusConfigs?: WorkStatusDisplay[]): WorkOption => ({
  value: status,
  label: workStatusLabel(status, statusConfigs),
  color: workStatusColor(status, statusConfigs),
})

export function WorkStatusSelect({
  value,
  onValueChange,
  activeStages,
  workStatus,
  stageId,
  stagesById,
  statusConfigs,
  triggerClassName,
  leadingItems,
}: {
  value: string
  onValueChange: (value: string) => void
  activeStages: WorkStage[]
  workStatus: WorkStatus
  stageId: string | null
  stagesById: Map<string, WorkStage>
  statusConfigs?: WorkStatusDisplay[]
  triggerClassName?: string
  // Extra action items rendered above "Received" (e.g. the work queue's
  // "Resume" option for on-hold cards). Can carry a color when it points to a
  // concrete work status.
  leadingItems?: Array<{ value: string; label: string; color?: string; colorLabel?: string }>
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
      label: workLabel(workStatus, stageId, stagesById, statusConfigs),
      color: workColor(workStatus, stageId, stagesById, statusConfigs),
    })
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          'h-8 w-44 text-xs font-medium border-transparent',
          workColor(workStatus, stageId, stagesById, statusConfigs),
          triggerClassName,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {leadingItems && leadingItems.length > 0 && (
          <>
            {leadingItems.map(o => (
              o.color ? (
                <SelectItem key={o.value} value={o.value} textValue={o.label} className="py-2">
                  <span className="flex max-w-full items-center gap-2">
                    <span className="shrink-0 text-sm">{o.label}</span>
                    <span className={cn('inline-flex min-w-0 items-center rounded-full px-2.5 py-0.5 text-sm font-medium leading-5', o.color)}>
                      <span className="truncate">{o.colorLabel ?? o.label}</span>
                    </span>
                  </span>
                </SelectItem>
              ) : (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              )
            ))}
            <SelectSeparator />
          </>
        )}
        <WorkOptionItem option={fixed('received', statusConfigs)} />
        <SelectGroup>
          <SelectLabel>In Progress</SelectLabel>
          {inProgress.map(o => (
            <WorkOptionItem key={o.value} option={o} />
          ))}
        </SelectGroup>
        <WorkOptionItem option={fixed('ready', statusConfigs)} />
        <WorkOptionItem option={fixed('delivered', statusConfigs)} />
        <WorkOptionItem option={fixed('on_hold', statusConfigs)} />
      </SelectContent>
    </Select>
  )
}
