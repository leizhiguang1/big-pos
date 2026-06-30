import { describe, it, expect } from 'vitest'
import { presetRange, buildPresets, matchPreset } from './reports-presets'

// Local-time construction; date-fns + format() are local, so assertions are
// timezone-independent (all comparisons happen on yyyy-MM-dd strings).
const NOW = new Date('2026-06-15T10:00:00')

describe('presetRange', () => {
  it('this month', () => {
    expect(presetRange('month', NOW)).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })
  it('last month', () => {
    expect(presetRange('lastMonth', NOW)).toEqual({ from: '2026-05-01', to: '2026-05-31' })
  })
  it('this quarter (Q2 Apr–Jun)', () => {
    expect(presetRange('quarter', NOW)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
  })
  it('year to date ends today', () => {
    expect(presetRange('ytd', NOW)).toEqual({ from: '2026-01-01', to: '2026-06-15' })
  })
})

describe('matchPreset', () => {
  const presets = buildPresets(NOW)
  it('round-trips each named preset', () => {
    for (const k of ['month', 'lastMonth', 'quarter', 'ytd'] as const) {
      expect(matchPreset(presets[k].from, presets[k].to, presets)).toBe(k)
    }
  })
  it('returns custom for an arbitrary range', () => {
    expect(matchPreset('2026-06-03', '2026-06-09', presets)).toBe('custom')
  })
})
