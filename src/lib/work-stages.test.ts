import { describe, it, expect } from 'vitest'
import type { WorkStatus, WorkStage } from '@/lib/database.types'
import {
  encodeWork, decodeWork, workOptions, workOptionsForItem,
  workLabel, workColor, labelForValue, colorForValue,
  orderedGroupKeys, STAGE_DEFAULT_COLOR,
  dotColorClass, nextWorkStep, workSubStatusLabel,
  matchesWorkFilter,
} from '@/lib/work-stages'
import { WORK_STATUS_LABELS, WORK_STATUS_COLORS } from '@/lib/work-status'

const stage = (
  id: string, label: string, sort: number,
  color: string | null = null, is_active = true,
): WorkStage => ({ id, label, color, sort_order: sort, is_active, created_at: '2026-06-11T00:00:00Z' })

const tray = stage('s1', 'Custom Tray', 10, 'bg-blue-100 text-blue-700')
const tryin = stage('s2', 'Try-in', 20, 'bg-amber-100 text-amber-700')
const active = [tray, tryin]
const byId = new Map(active.map(s => [s.id, s]))

describe('encodeWork / decodeWork', () => {
  it('round-trips every phase and stage', () => {
    const cases: Array<[WorkStatus, string | null]> = [
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
})

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

describe('workLabel / workColor', () => {
  it('uses the stage label+color for an active staged item', () => {
    expect(workLabel('in_progress', 's1', byId)).toBe('Custom Tray')
    expect(workColor('in_progress', 's1', byId)).toBe('bg-blue-100 text-blue-700')
  })
  it('falls back to the phase label+color for non-stage statuses', () => {
    expect(workLabel('ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
    expect(workColor('ready', null, byId)).toBe(WORK_STATUS_COLORS.ready)
  })
  it('falls back to In Progress when the stage is unknown or missing', () => {
    expect(workLabel('in_progress', 'gone', byId)).toBe(WORK_STATUS_LABELS.in_progress)
    expect(workColor('in_progress', null, byId)).toBe(WORK_STATUS_COLORS.in_progress)
  })
})

describe('labelForValue / colorForValue', () => {
  it('decodes a group-key value then resolves label + color', () => {
    expect(labelForValue('stage:s2', byId)).toBe('Try-in')
    expect(colorForValue('stage:s2', byId)).toBe('bg-amber-100 text-amber-700')
    expect(labelForValue('ready', byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})

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
    // Guards the subtle "flush extras at the canonical Ready position" logic: a
    // refactor that gated the flush on `ready` being present would drop this group.
    const present = ['received', 'stage:old']
    expect(orderedGroupKeys(active, present)).toEqual(['received', 'stage:old'])
  })
})


describe('dotColorClass', () => {
  it('derives a saturated dot from a pale pill class', () => {
    expect(dotColorClass('bg-blue-100 text-blue-700')).toBe('bg-blue-500')
    expect(dotColorClass('bg-amber-100 text-amber-700')).toBe('bg-amber-500')
  })
  it('handles the delivered pill (bg-gray-50 + ring)', () => {
    expect(dotColorClass('bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200')).toBe('bg-gray-500')
  })
  it('falls back to a neutral dot when no bg color is found', () => {
    expect(dotColorClass('text-only-no-bg')).toBe('bg-gray-400')
  })
})

describe('nextWorkStep', () => {
  it('received advances to bare in_progress (sub-status is picked explicitly)', () => {
    expect(nextWorkStep('received')).toEqual({ work_status: 'in_progress', stage_id: null })
  })
  it('in_progress advances straight to ready, regardless of stage', () => {
    expect(nextWorkStep('in_progress')).toEqual({ work_status: 'ready', stage_id: null })
  })
  it('ready advances to delivered', () => {
    expect(nextWorkStep('ready')).toEqual({ work_status: 'delivered', stage_id: null })
  })
  it('delivered has no next step', () => {
    expect(nextWorkStep('delivered')).toBeNull()
  })
  it('on_hold has no next step (Resume covers it)', () => {
    expect(nextWorkStep('on_hold')).toBeNull()
  })
})

describe('workSubStatusLabel', () => {
  it('labels a staged in-progress item as "In Progress · <stage>"', () => {
    expect(workSubStatusLabel('in_progress', 's1', byId)).toBe(`${WORK_STATUS_LABELS.in_progress} · Custom Tray`)
    expect(workSubStatusLabel('in_progress', 's2', byId)).toBe(`${WORK_STATUS_LABELS.in_progress} · Try-in`)
  })
  it('labels a bare in-progress item as the plain In Progress label', () => {
    expect(workSubStatusLabel('in_progress', null, byId)).toBe(WORK_STATUS_LABELS.in_progress)
  })
  it('falls back to the plain label for an unknown/retired stage', () => {
    expect(workSubStatusLabel('in_progress', 'gone', byId)).toBe(WORK_STATUS_LABELS.in_progress)
  })
  it('uses the plain work label for non-in-progress statuses', () => {
    expect(workSubStatusLabel('ready', null, byId)).toBe(WORK_STATUS_LABELS.ready)
  })
})

describe('matchesWorkFilter', () => {
  it('all matches everything', () => {
    expect(matchesWorkFilter('all', 'delivered', null)).toBe(true)
  })
  it('active excludes delivered only', () => {
    expect(matchesWorkFilter('active', 'in_progress', 's1')).toBe(true)
    expect(matchesWorkFilter('active', 'delivered', null)).toBe(false)
  })
  it('a bare status matches that status', () => {
    expect(matchesWorkFilter('in_progress', 'in_progress', null)).toBe(true)
    expect(matchesWorkFilter('in_progress', 'ready', null)).toBe(false)
  })
  it('a stage filter matches only that in-progress stage', () => {
    expect(matchesWorkFilter('stage:s1', 'in_progress', 's1')).toBe(true)
    expect(matchesWorkFilter('stage:s1', 'in_progress', 's2')).toBe(false)
    expect(matchesWorkFilter('stage:s1', 'ready', null)).toBe(false)
  })
})
