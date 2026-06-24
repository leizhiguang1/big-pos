import { describe, it, expect } from 'vitest'
import type { WorkStage } from '@/lib/database.types'
import type { WorkStatusDisplay } from '@/lib/work-status-config'
import {
  WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_COLORS,
  nextWorkStatus, hold, resume,
  encodeWork, decodeWork,
  workOptions, workOptionsForItem,
  workLabel, workColor, labelForValue, colorForValue,
  orderedGroupKeys, STAGE_DEFAULT_COLOR,
} from './production'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stage = (
  id: string, label: string, sort: number,
  color: string | null = null, is_active = true,
): WorkStage => ({ id, label, color, sort_order: sort, is_active, created_at: '2026-06-11T00:00:00Z' })

const tray  = stage('s1', 'Custom Tray', 10, 'bg-blue-100 text-blue-700')
const tryin = stage('s2', 'Try-in',      20, 'bg-amber-100 text-amber-700')
const active = [tray, tryin]
const byId   = new Map(active.map(s => [s.id, s]))
const statusConfigs: WorkStatusDisplay[] = [
  { status: 'received', label: 'New Case', color: 'bg-cyan-100 text-cyan-700', sort_order: 10 },
  { status: 'ready', label: 'Ready for Pickup', color: 'bg-emerald-100 text-emerald-700', sort_order: 30 },
]

// ---------------------------------------------------------------------------
// WORK_STATUSES — ported from work-status.test.ts
// ---------------------------------------------------------------------------

describe('work statuses (qc removed)', () => {
  it('no longer lists qc', () => {
    expect(WORK_STATUSES).toEqual(['received', 'in_progress', 'ready', 'delivered', 'on_hold'])
    expect('qc' in WORK_STATUS_LABELS).toBe(false)
    expect('qc' in WORK_STATUS_COLORS).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// nextWorkStatus — ported from work-status.test.ts
// ---------------------------------------------------------------------------

describe('nextWorkStatus', () => {
  it('flows in_progress straight to ready (no qc step)', () => {
    expect(nextWorkStatus('in_progress')).toBe('ready')
    expect(nextWorkStatus('received')).toBe('in_progress')
    expect(nextWorkStatus('delivered')).toBeNull()
  })
  it('advances along the linear flow', () => {
    expect(nextWorkStatus('received')).toBe('in_progress')
    expect(nextWorkStatus('ready')).toBe('delivered')
    expect(nextWorkStatus('delivered')).toBe(null)
  })
  it('on_hold has no linear next', () => {
    expect(nextWorkStatus('on_hold')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// hold / resume — new on_hold round-trip helpers
// ---------------------------------------------------------------------------

describe('hold / resume', () => {
  it('hold remembers prior status', () => {
    expect(hold('in_progress')).toEqual({ status: 'on_hold', resumeFrom: 'in_progress' })
    expect(hold('received')).toEqual({ status: 'on_hold', resumeFrom: 'received' })
  })
  it('resume returns to the prior status', () => {
    expect(resume('in_progress')).toBe('in_progress')
    expect(resume('ready')).toBe('ready')
  })
  it('resume(null) falls back to received', () => {
    expect(resume(null)).toBe('received')
  })
})

// ---------------------------------------------------------------------------
// encodeWork / decodeWork — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('encodeWork / decodeWork', () => {
  it('round-trips every phase and stage', () => {
    const cases: Array<[Parameters<typeof encodeWork>[0], string | null]> = [
      ['received', null], ['in_progress', 's1'], ['in_progress', null],
      ['ready', null], ['delivered', null], ['on_hold', null],
    ]
    for (const [ws, sid] of cases) {
      expect(decodeWork(encodeWork(ws, sid))).toEqual({ work_status: ws, stage_id: sid })
    }
  })
  it('encodes a staged in_progress as "stage:<id>"', () => {
    expect(encodeWork('in_progress', 's1')).toBe('stage:s1')
  })
  it('encodes a stage-less in_progress as "in_progress"', () => {
    expect(encodeWork('in_progress', null)).toBe('in_progress')
  })
})

// ---------------------------------------------------------------------------
// workOptions — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('workOptions', () => {
  it('lists Received, active stages in order, then Ready/Delivered/On Hold', () => {
    expect(workOptions(active).map(o => o.value)).toEqual([
      'received', 'stage:s1', 'stage:s2', 'ready', 'delivered', 'on_hold',
    ])
  })
  it('uses the stage color, falling back to the default', () => {
    const noColor = [stage('s3', 'Bake', 30, null)]
    expect(workOptions(noColor)[1]).toEqual({ value: 'stage:s3', label: 'Bake', color: STAGE_DEFAULT_COLOR })
  })
  it('keeps the same option order while using configured status display', () => {
    const opts = workOptions(active, statusConfigs)
    expect(opts.map(o => o.value)).toEqual([
      'received', 'stage:s1', 'stage:s2', 'ready', 'delivered', 'on_hold',
    ])
    expect(opts[0]).toEqual({ value: 'received', label: 'New Case', color: 'bg-cyan-100 text-cyan-700' })
    expect(opts[3]).toEqual({ value: 'ready', label: 'Ready for Pickup', color: 'bg-emerald-100 text-emerald-700' })
  })
})

// ---------------------------------------------------------------------------
// workOptionsForItem — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('workOptionsForItem', () => {
  it('returns the base options when the current value is already present', () => {
    expect(workOptionsForItem(active, 'received', null, byId)).toEqual(workOptions(active))
  })
  it('injects an inactive stage the item still sits on, right after Received', () => {
    const inactive = stage('old', 'Wax Up', 99, 'bg-pink-100 text-pink-700', false)
    const map = new Map([...byId, [inactive.id, inactive]])
    const opts = workOptionsForItem(active, 'in_progress', 'old', map)
    expect(opts.map(o => o.value)).toEqual([
      'received', 'stage:old', 'stage:s1', 'stage:s2', 'ready', 'delivered', 'on_hold',
    ])
    expect(opts[1]).toEqual({ value: 'stage:old', label: 'Wax Up', color: 'bg-pink-100 text-pink-700' })
  })
  it('injects a stage-less In Progress item', () => {
    const opts = workOptionsForItem(active, 'in_progress', null, byId)
    const inProg = opts.find(o => o.value === 'in_progress')
    expect(inProg?.label).toBe(WORK_STATUS_LABELS.in_progress)
  })
})

// ---------------------------------------------------------------------------
// workLabel / workColor — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('workLabel / workColor', () => {
  it('uses the stage label+color for an active staged item', () => {
    expect(workLabel('in_progress', 's1', byId)).toBe('Custom Tray')
    expect(workColor('in_progress', 's1', byId)).toBe('bg-blue-100 text-blue-700')
  })
  it('falls back to the phase label+color for non-stage statuses', () => {
    expect(workLabel('ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
    expect(workColor('ready', null, byId)).toBe(WORK_STATUS_COLORS.ready)
  })
  it('uses configured phase labels and colors when provided', () => {
    expect(workLabel('ready', null, byId, statusConfigs)).toBe('Ready for Pickup')
    expect(workColor('ready', null, byId, statusConfigs)).toBe('bg-emerald-100 text-emerald-700')
  })
  it('falls back to In Progress when the stage is unknown or missing', () => {
    expect(workLabel('in_progress', 'gone', byId)).toBe(WORK_STATUS_LABELS.in_progress)
    expect(workColor('in_progress', null, byId)).toBe(WORK_STATUS_COLORS.in_progress)
  })
})

// ---------------------------------------------------------------------------
// labelForValue / colorForValue — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('labelForValue / colorForValue', () => {
  it('decodes a group-key value then resolves label + color', () => {
    expect(labelForValue('stage:s2', byId)).toBe('Try-in')
    expect(colorForValue('stage:s2', byId)).toBe('bg-amber-100 text-amber-700')
    expect(labelForValue('ready', byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})

// ---------------------------------------------------------------------------
// orderedGroupKeys — ported from work-stages.test.ts
// ---------------------------------------------------------------------------

describe('orderedGroupKeys', () => {
  it('orders present groups canonically', () => {
    const present = ['ready', 'stage:s2', 'received', 'on_hold']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:s2', 'ready', 'on_hold'])
  })
  it('places inactive-stage / stage-less groups at the end of the In Progress region', () => {
    const present = ['received', 'stage:old', 'in_progress', 'ready']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:old', 'in_progress', 'ready'])
  })
  it('de-dupes repeated present keys', () => {
    const present = ['received', 'received', 'stage:s1', 'stage:s1']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:s1'])
  })
  it('still emits an extra group when no Ready items are present', () => {
    const present = ['received', 'stage:old']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:old'])
  })
})
