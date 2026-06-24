import type { WorkStage, WorkStatus } from './database.types'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from './work-status-config'

// Pill color used when a stage has no color set (mirrors service-status DEFAULT_COLOR).
export const STAGE_DEFAULT_COLOR = 'bg-gray-100 text-gray-700'

// All stages (active + inactive), ordered. The dropdown only OFFERS active stages,
// but inactive ones are still needed to LABEL items left sitting on a retired stage.
export async function fetchWorkStages(): Promise<WorkStage[]> {
  // Lazy import: `./supabase` constructs its client at module load, which throws in
  // the vitest node env. Importing it dynamically here keeps the pure helpers below
  // importable by tests without a client. Do NOT hoist this to a top-level import.
  const { supabase } = await import('./supabase')
  const { data } = await supabase
    .from('work_stages')
    .select('*')
    .order('sort_order')
    .order('label')
  return data ?? []
}

// ---- Pure helpers (unit-tested) -------------------------------------------

export type WorkOption = { value: string; label: string; color: string }

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

// Canonical ordered options (also the canonical group order):
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
// it sits on a now-inactive stage or is In-Progress with no stage (so shadcn's
// SelectValue can render it). The extra is inserted at the start of the
// In-Progress region (right after "Received").
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


// Derive a saturated dot color (`bg-<hue>-500`) from a pale pill class
// (`bg-<hue>-100 text-<hue>-700`). Falls back to a neutral dot when no bg hue
// is found. Used to render visible color swatches in the status dropdown.
export function dotColorClass(pillColor: string): string {
  const m = pillColor.match(/bg-([a-z]+)-\d+/)
  return m ? `bg-${m[1]}-500` : 'bg-gray-400'
}

// Forward "advance" target for the one-click Advance action — TOP-LEVEL only.
// Sub-stages are labeled sub-statuses, not a pipeline, so advancing never walks
// stage→stage; received lands on BARE in_progress (the user then picks a sub-status).
// Returns null when there is no next step (delivered; on_hold uses Resume instead).
export function nextWorkStep(
  work_status: WorkStatus,
): { work_status: WorkStatus; stage_id: string | null } | null {
  switch (work_status) {
    case 'received':
      return { work_status: 'in_progress', stage_id: null }
    case 'in_progress':
      return { work_status: 'ready', stage_id: null }
    case 'ready':
      return { work_status: 'delivered', stage_id: null }
    default: // delivered, on_hold
      return null
  }
}

// Label for the trigger pill / badge. A staged in-progress item reads as a
// sub-status of In Progress: "In Progress · Try In". Bare in-progress and every
// other status use their plain work label. (No position/count — stages are
// labeled sub-statuses, not an ordered sequence.)
export function workSubStatusLabel(
  work_status: WorkStatus,
  stage_id: string | null,
  stagesById: Map<string, WorkStage>,
  statusConfigs?: WorkStatusDisplay[],
): string {
  if (work_status === 'in_progress' && stage_id) {
    const s = stagesById.get(stage_id)
    if (s) return `${workStatusLabel('in_progress', statusConfigs)} · ${s.label}`
  }
  return workLabel(work_status, stage_id, stagesById, statusConfigs)
}

// Work-queue filter predicate. `filter` is 'all' | 'active' | a WorkStatus | "stage:<id>".
export function matchesWorkFilter(filter: string, work_status: WorkStatus, stage_id: string | null): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return work_status !== 'delivered'
  if (filter.startsWith('stage:')) return work_status === 'in_progress' && stage_id === filter.slice('stage:'.length)
  return work_status === filter
}
