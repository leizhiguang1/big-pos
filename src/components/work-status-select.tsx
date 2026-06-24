'use client'

// Shared work-status dropdown: a colored trigger pill (with in-progress position)
// plus colored option pills. Configurable stages render as numbered, indented
// steps under an "In Progress" header; the current step is checked. A leading
// "Advance to <next>" row performs the one-click forward move. Used by the
// invoice-detail Work Status card and the work queue so all render identically.

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger,
} from '@/components/ui/select'
import { ManageOptionsLink } from '@/components/ui/manage-options-link'
import { cn } from '@/lib/utils'
import {
  encodeWork, nextWorkStep, workColor, workLabel, workSubStatusLabel,
  STAGE_DEFAULT_COLOR, type WorkOption,
} from '@/lib/work-stages'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'
import { Check, ArrowRight } from 'lucide-react'
import type { WorkStage, WorkStatus } from '@/lib/database.types'

// Sentinel emitted by the "Advance to next" row. Parents resolve it with
// nextWorkStep() against the item's current (work_status, stage_id).
export const ADVANCE_VALUE = '__advance__'

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

  const next = nextWorkStep(workStatus)
  const triggerLabel = workSubStatusLabel(workStatus, stageId, stagesById, statusConfigs)

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          'h-9 min-w-44 text-sm font-medium border-transparent',
          workColor(workStatus, stageId, stagesById, statusConfigs),
          triggerClassName,
        )}
      >
        <span className="truncate">{triggerLabel}</span>
      </SelectTrigger>
      <SelectContent>
        {next && (
          <>
            <SelectItem value={ADVANCE_VALUE} textValue="Advance" className="py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-primary">
                <ArrowRight className="h-3.5 w-3.5" />
                Advance to {workLabel(next.work_status, next.stage_id, stagesById, statusConfigs)}
              </span>
            </SelectItem>
            <SelectSeparator />
          </>
        )}
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
        {/* In-Progress sub-statuses live in their own tinted sub-panel so they
            read as a contained group of "In Progress" and never blend into the
            top-level status rows above/below. */}
        <div className="my-1 rounded-md border border-border/70 bg-muted/40 p-1">
          <SelectGroup>
            <SelectLabel className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In Progress</SelectLabel>
            {/* "No sub-status" — bare in_progress; lets a user enter In Progress
                without a stage, or clear a stage back to none. */}
            <SelectItem value="in_progress" textValue="No sub-status" className="py-2">
              <span className="flex w-full items-center gap-2">
                <span className="text-sm text-muted-foreground">No sub-status</span>
                {current === 'in_progress' && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </span>
            </SelectItem>
            {inProgress.map(o => (
              <SelectItem key={o.value} value={o.value} textValue={o.label} className="py-2">
                <span className="flex w-full items-center gap-2">
                  <OptionRow option={o} />
                  {o.value === current && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </div>
        <WorkOptionItem option={fixed('ready', statusConfigs)} />
        <WorkOptionItem option={fixed('delivered', statusConfigs)} />
        <WorkOptionItem option={fixed('on_hold', statusConfigs)} />
        <ManageOptionsLink href="/settings/work-statuses" label="Manage statuses & stages" />
      </SelectContent>
    </Select>
  )
}
