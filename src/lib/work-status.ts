import type { WorkStatus } from './database.types'

export const WORK_STATUSES: WorkStatus[] = [
  'received',
  'in_progress',
  'ready',
  'delivered',
  'on_hold',
]

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  received: 'Received',
  in_progress: 'In Progress',
  ready: 'Ready',
  delivered: 'Done',
  on_hold: 'On Hold',
}

// Notion-style soft pill colors. Pastel bg + readable text. Picked so the
// progression is scannable at a glance: gray (new) → blue (active) → purple
// (review) → green (done) → muted (delivered/archived) + orange for held.
export const WORK_STATUS_COLORS: Record<WorkStatus, string> = {
  received:    'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  ready:       'bg-green-100 text-green-700',
  delivered:   'bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200',
  on_hold:     'bg-orange-100 text-orange-700',
}

// Solid filled palette — used for "selected" chips so the active filter is
// unmistakable. Same hue family as the pastel WORK_STATUS_COLORS. The
// matching `border` keeps layout aligned with the outlined variant.
export const WORK_STATUS_FILLED: Record<WorkStatus, string> = {
  received:    'bg-gray-600 text-white border border-gray-600',
  in_progress: 'bg-blue-600 text-white border border-blue-600',
  ready:       'bg-green-600 text-white border border-green-600',
  delivered:   'bg-gray-500 text-white border border-gray-500',
  on_hold:     'bg-orange-600 text-white border border-orange-600',
}

// Outlined palette — colored border + colored text on white. Used for
// inactive filter chips so the stage is identifiable even when not selected,
// without competing with the filled (active) chip for attention.
export const WORK_STATUS_OUTLINED: Record<WorkStatus, string> = {
  received:    'bg-white border border-gray-400 text-gray-700',
  in_progress: 'bg-white border border-blue-500 text-blue-700',
  ready:       'bg-white border border-green-600 text-green-700',
  delivered:   'bg-white border border-gray-300 text-gray-500',
  on_hold:     'bg-white border border-orange-500 text-orange-700',
}

// Work status is tracked per service item (one invoice line = one work), never
// rolled up to a single invoice-level status. Aggregation helpers
// (dominantWorkStatus / summarizeWorkStatuses) were removed deliberately.

const LINEAR_FLOW: WorkStatus[] = ['received', 'in_progress', 'ready', 'delivered']

export function nextWorkStatus(current: WorkStatus): WorkStatus | null {
  const idx = LINEAR_FLOW.indexOf(current)
  if (idx === -1 || idx === LINEAR_FLOW.length - 1) return null
  return LINEAR_FLOW[idx + 1]
}
