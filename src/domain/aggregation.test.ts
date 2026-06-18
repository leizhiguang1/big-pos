import { describe, it, expect } from 'vitest'
import { dominantProductionStatus } from './aggregation'
describe('aggregation', () => {
  it('attention-first: on_hold dominates', () =>
    expect(dominantProductionStatus([{ work_status: 'delivered' }, { work_status: 'on_hold' }])).toBe('on_hold'))
  it('least-progressed wins among active', () =>
    expect(dominantProductionStatus([{ work_status: 'ready' }, { work_status: 'received' }])).toBe('received'))
  it('empty -> received', () => expect(dominantProductionStatus([])).toBe('received'))
})
