import type { WorkStatus, WorkStatusConfig } from './database.types'
import { WORK_STATUSES, WORK_STATUS_COLORS, WORK_STATUS_LABELS } from './work-status'

export type WorkStatusDisplay = Pick<WorkStatusConfig, 'status' | 'label' | 'color' | 'sort_order'>

export const DEFAULT_WORK_STATUS_CONFIGS: WorkStatusDisplay[] = WORK_STATUSES.map((status, index) => ({
  status,
  label: WORK_STATUS_LABELS[status],
  color: WORK_STATUS_COLORS[status],
  sort_order: (index + 1) * 10,
}))

export function workStatusConfigMap(configs: WorkStatusDisplay[] = []): Map<WorkStatus, WorkStatusDisplay> {
  const map = new Map<WorkStatus, WorkStatusDisplay>()
  for (const config of DEFAULT_WORK_STATUS_CONFIGS) map.set(config.status, config)
  for (const config of configs) {
    const fallback = map.get(config.status)
    map.set(config.status, {
      status: config.status,
      label: config.label || fallback?.label || WORK_STATUS_LABELS[config.status],
      color: config.color ?? fallback?.color ?? WORK_STATUS_COLORS[config.status],
      sort_order: config.sort_order ?? fallback?.sort_order ?? 0,
    })
  }
  return map
}

export function workStatusLabel(status: WorkStatus, configs?: WorkStatusDisplay[]): string {
  return workStatusConfigMap(configs).get(status)?.label ?? WORK_STATUS_LABELS[status]
}

export function workStatusColor(status: WorkStatus, configs?: WorkStatusDisplay[]): string {
  return workStatusConfigMap(configs).get(status)?.color ?? WORK_STATUS_COLORS[status]
}

export function workStatusDisplays(configs?: WorkStatusDisplay[]): WorkStatusDisplay[] {
  const map = workStatusConfigMap(configs)
  return WORK_STATUSES.map(status => map.get(status)!)
}

export async function fetchWorkStatusConfigs(): Promise<WorkStatusConfig[]> {
  const { supabase } = await import('./supabase')
  const { data } = await supabase
    .from('work_status_configs')
    .select('*')
    .order('sort_order')
  return (data ?? []) as WorkStatusConfig[]
}
