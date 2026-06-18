import type { WorkStatus } from './production'

const DOMINANT_PRIORITY: WorkStatus[] = ['on_hold', 'received', 'in_progress', 'ready', 'delivered']

export const dominantProductionStatus = (items: { work_status: WorkStatus | string }[]): WorkStatus => {
  if (items.length === 0) return 'received'
  for (const status of DOMINANT_PRIORITY) {
    if (items.some((i) => i.work_status === status)) return status
  }
  return 'received'
}

export const summarizeProduction = (items: { work_status: WorkStatus | string }[]) =>
  DOMINANT_PRIORITY.reduce<Record<string, number>>((acc, s) => {
    acc[s] = items.filter((i) => i.work_status === s).length
    return acc
  }, {})
