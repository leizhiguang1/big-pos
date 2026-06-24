import { describe, it, expect } from 'vitest'
import {
  WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_COLORS,
  nextWorkStatus,
} from '@/lib/work-status'

describe('work statuses (qc removed)', () => {
  it('no longer lists qc', () => {
    expect(WORK_STATUSES).toEqual(['received', 'in_progress', 'ready', 'delivered', 'on_hold'])
    expect('qc' in WORK_STATUS_LABELS).toBe(false)
    expect('qc' in WORK_STATUS_COLORS).toBe(false)
  })
  it('flows in_progress straight to ready (no qc step)', () => {
    expect(nextWorkStatus('in_progress')).toBe('ready')
    expect(nextWorkStatus('received')).toBe('in_progress')
    expect(nextWorkStatus('delivered')).toBeNull()
  })
})
