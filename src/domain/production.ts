// Production state machine for work items.
// Ports src/lib/work-status.ts + src/lib/work-stages.ts (verbatim shapes).
// dominantWorkStatus and summarizeWorkStatuses are intentionally omitted —
// they live in the aggregation module (Task 7).

import type { WorkStage, WorkStatus } from '@/lib/database.types'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'

// ---------------------------------------------------------------------------
// WorkStatus — derived from the DB enum (single source of truth); re-exported
// so the domain layer stays the one import point for consumers.
// ---------------------------------------------------------------------------

export type { WorkStatus }

export const WORK_STATUSES: WorkStatus[] = [
  'received',
  'in_progress',
  'ready',
  'delivered',
  'on_hold',
]

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  received:    'Received',
  in_progress: 'In Progress',
  ready:       'Ready',
  delivered:   'Delivered',
  on_hold:     'On Hold',
}

// Notion-style soft pill colors. Pastel bg + readable text.
export const WORK_STATUS_COLORS: Record<WorkStatus, string> = {
  received:    'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  ready:       'bg-green-100 text-green-700',
  delivered:   'bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200',
  on_hold:     'bg-orange-100 text-orange-700',
}

// Solid filled palette — used for "selected" chips.
export const WORK_STATUS_FILLED: Record<WorkStatus, string> = {
  received:    'bg-gray-600 text-white border border-gray-600',
  in_progress: 'bg-blue-600 text-white border border-blue-600',
  ready:       'bg-green-600 text-white border border-green-600',
  delivered:   'bg-gray-500 text-white border border-gray-500',
  on_hold:     'bg-orange-600 text-white border border-orange-600',
}

// Outlined palette — colored border + colored text on white.
export const WORK_STATUS_OUTLINED: Record<WorkStatus, string> = {
  received:    'bg-white border border-gray-400 text-gray-700',
  in_progress: 'bg-white border border-blue-500 text-blue-700',
  ready:       'bg-white border border-green-600 text-green-700',
  delivered:   'bg-white border border-gray-300 text-gray-500',
  on_hold:     'bg-white border border-orange-500 text-orange-700',
}

// ---------------------------------------------------------------------------
// Linear flow state machine
// ---------------------------------------------------------------------------

export const LINEAR_FLOW: WorkStatus[] = ['received', 'in_progress', 'ready', 'delivered']

export function nextWorkStatus(current: WorkStatus): WorkStatus | null {
  const idx = LINEAR_FLOW.indexOf(current)
  if (idx === -1 || idx === LINEAR_FLOW.length - 1) return null
  return LINEAR_FLOW[idx + 1]
}

// ---------------------------------------------------------------------------
// on_hold round-trip
// ---------------------------------------------------------------------------

export const hold = (current: WorkStatus) =>
  ({ status: 'on_hold' as const, resumeFrom: current })

export const resume = (resumeFrom: WorkStatus | null): WorkStatus =>
  resumeFrom ?? 'received'

// ---------------------------------------------------------------------------
// Encode / decode (work_status, stage_id) — verbatim from work-stages.ts
// ---------------------------------------------------------------------------

// Pill color used when a stage has no color set.
export const STAGE_DEFAULT_COLOR = 'bg-gray-100 text-gray-700'

// (work_status, stage_id) -> Select `value` string.
//   in_progress + stage  -> "stage:<id>"
//   in_progress + null    -> "in_progress"
//   any other phase       -> the bare WorkStatus
export function encodeWork(work_status: WorkStatus, stage_id: string | null): string {
  if (work_status === 'in_progress') return stage_id ? `stage:${stage_id}` : 'in_progress'
  return work_status
}

// Inverse of encodeWork.
export function decodeWork(value: string): { work_status: WorkStatus; stage_id: string | null } {
  if (value.startsWith('stage:')) return { work_status: 'in_progress', stage_id: value.slice('stage:'.length) }
  if (value === 'in_progress') return { work_status: 'in_progress', stage_id: null }
  return { work_status: value as WorkStatus, stage_id: null }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// Display label for a current (work_status, stage_id).
export function workLabel(
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return s.label
  }
  return workStatusLabel(work_status, statusConfigs)
}

// Pill color classes for a current (work_status, stage_id).
export function workColor(
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return s.color ?? STAGE_DEFAULT_COLOR
  }
  return workStatusColor(work_status, statusConfigs)
}

// Same as workLabel/workColor but keyed by an encoded group/option value.
export function labelForValue(value: string, stagesById: Map<string, WorkStage>, statusConfigs?: WorkStatusDisplay[]): string {
  const { work_status, stage_id } = decodeWork(value)
  return workLabel(work_status, stage_id, stagesById, statusConfigs)
}
export function colorForValue(value: string, stagesById: Map<string, WorkStage>, statusConfigs?: WorkStatusDisplay[]): string {
  const { work_status, stage_id } = decodeWork(value)
  return workColor(work_status, stage_id, stagesById, statusConfigs)
}

// ---------------------------------------------------------------------------
// Option builders
// ---------------------------------------------------------------------------

export type WorkOption = { value: string; label: string; color: string }

// Canonical ordered options:
// Received, each active stage (in order), Ready, Delivered, On Hold.
export function workOptions(activeStages: WorkStage[], statusConfigs?: WorkStatusDisplay[]): WorkOption[] {
  return [
    { value: 'received', label: workStatusLabel('received', statusConfigs), color: workStatusColor('received', statusConfigs) },
    ...activeStages.map(s => ({ value: `stage:${s.id}`, label: s.label, color: s.color ?? STAGE_DEFAULT_COLOR })),
    { value: 'ready', label: workStatusLabel('ready', statusConfigs), color: workStatusColor('ready', statusConfigs) },
    { value: 'delivered', label: workStatusLabel('delivered', statusConfigs), color: workStatusColor('delivered', statusConfigs) },
    { value: 'on_hold', label: workStatusLabel('on_hold', statusConfigs), color: workStatusColor('on_hold', statusConfigs) },
  ]
}

// Options for ONE item, guaranteeing the item's current value is present even if
// it sits on a now-inactive stage or is In-Progress with no stage.
export function workOptionsForItem(
  activeStages: WorkStage[],
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): WorkOption[] {
  const base = workOptions(activeStages, statusConfigs)
  const current = encodeWork(work_status, stage_id)
  if (base.some(o => o.value === current)) return base
  const extra: WorkOption = {
    value: current,
    label: workLabel(work_status, stage_id, stagesById, statusConfigs),
    color: workColor(work_status, stage_id, stagesById, statusConfigs),
  }
  const insertAt = base.findIndex(o => o.value === 'received') + 1
  return [...base.slice(0, insertAt), extra, ...base.slice(insertAt)]
}

// Group-key ordering for the work queue. Canonical order, with any present keys
// not in the canonical list (inactive stages / bare in_progress) placed at the
// end of the In-Progress region (just before "Ready"), in their incoming order.
export function orderedGroupKeys(activeStages: WorkStage[], present: string[]): string[] {
  const canonical = workOptions(activeStages).map(o => o.value)
  const presentSet = new Set(present)
  const extras = present.filter(k => !canonical.includes(k))
  const out: string[] = []
  for (const key of canonical) {
    if (key === 'ready') out.push(...extras)
    if (presentSet.has(key)) out.push(key)
  }
  return out
}
