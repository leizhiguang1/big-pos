import type { WorkStatus } from './database.types'

export const WORK_STATUSES: WorkStatus[] = [
  'received',
  'in_progress',
  'qc',
  'ready',
  'delivered',
  'on_hold',
]

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  received: 'Received',
  in_progress: 'In Progress',
  qc: 'QC',
  ready: 'Ready',
  delivered: 'Delivered',
  on_hold: 'On Hold',
}

// Notion-style soft pill colors. Pastel bg + readable text. Picked so the
// progression is scannable at a glance: gray (new) → blue (active) → purple
// (review) → green (done) → muted (delivered/archived) + orange for held.
export const WORK_STATUS_COLORS: Record<WorkStatus, string> = {
  received:    'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  qc:          'bg-purple-100 text-purple-700',
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
  qc:          'bg-purple-600 text-white border border-purple-600',
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
  qc:          'bg-white border border-purple-500 text-purple-700',
  ready:       'bg-white border border-green-600 text-green-700',
  delivered:   'bg-white border border-gray-300 text-gray-500',
  on_hold:     'bg-white border border-orange-500 text-orange-700',
}

// Priority order for picking ONE representative status across many items
// belonging to a single invoice. On-hold first (needs attention), then the
// least-progressed stage. Delivered is last because work that's out the door
// is the least useful single-line answer to "where's my order".
const DOMINANT_PRIORITY: WorkStatus[] = [
  'on_hold',
  'received',
  'in_progress',
  'qc',
  'ready',
  'delivered',
]

export function dominantWorkStatus(statuses: WorkStatus[]): WorkStatus | null {
  if (statuses.length === 0) return null
  const set = new Set(statuses)
  for (const s of DOMINANT_PRIORITY) {
    if (set.has(s)) return s
  }
  return null
}

const LINEAR_FLOW: WorkStatus[] = ['received', 'in_progress', 'qc', 'ready', 'delivered']

export function nextWorkStatus(current: WorkStatus): WorkStatus | null {
  const idx = LINEAR_FLOW.indexOf(current)
  if (idx === -1 || idx === LINEAR_FLOW.length - 1) return null
  return LINEAR_FLOW[idx + 1]
}

export function summarizeWorkStatuses(statuses: WorkStatus[]): {
  primary: WorkStatus | null
  breakdown: Array<{ status: WorkStatus; count: number }>
} {
  if (statuses.length === 0) return { primary: null, breakdown: [] }
  const counts = new Map<WorkStatus, number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  const breakdown = WORK_STATUSES.filter(s => counts.has(s)).map(s => ({
    status: s,
    count: counts.get(s)!,
  }))
  const primary = breakdown.length === 1 ? breakdown[0].status : null
  return { primary, breakdown }
}
