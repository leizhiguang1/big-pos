import { describe, expect, it } from 'vitest'
import { workStatusColor, workStatusDisplays, workStatusLabel } from './work-status-config'
import { WORK_STATUS_COLORS, WORK_STATUS_LABELS } from './work-status'

describe('work status display config', () => {
  it('falls back to fixed labels and colors when config rows are missing', () => {
    expect(workStatusLabel('received', [])).toBe(WORK_STATUS_LABELS.received)
    expect(workStatusColor('ready', [])).toBe(WORK_STATUS_COLORS.ready)
  })

  it('overrides label and color without changing canonical status order', () => {
    const rows = workStatusDisplays([
      { status: 'ready', label: 'Ready for delivery', color: 'bg-purple-100 text-purple-700', sort_order: 999 },
    ])

    expect(rows.map(r => r.status)).toEqual(['received', 'in_progress', 'ready', 'delivered', 'on_hold'])
    expect(workStatusLabel('ready', rows)).toBe('Ready for delivery')
    expect(workStatusColor('ready', rows)).toBe('bg-purple-100 text-purple-700')
  })

  it('uses the fixed color when a config row has no color', () => {
    expect(workStatusColor('on_hold', [
      { status: 'on_hold', label: 'Waiting', color: null, sort_order: 50 },
    ])).toBe(WORK_STATUS_COLORS.on_hold)
  })
})
