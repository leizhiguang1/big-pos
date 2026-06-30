// Pure date-range preset math for the Sales Reports page. No React/DOM so it
// stays unit-testable. The server builds the ranges from its `now` and passes
// them to the client, so the client never calls `new Date()` during render.

import {
  format,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  subMonths,
} from 'date-fns'

export type PresetKind = 'month' | 'lastMonth' | 'quarter' | 'ytd'
export type DateRange = { from: string; to: string }
export type PresetMap = Record<PresetKind, DateRange>

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

// Display order matters: Object.keys() preserves insertion order, and the
// client renders buttons in that order.
export const PRESET_LABELS: Record<PresetKind, string> = {
  month: 'This month',
  lastMonth: 'Last month',
  quarter: 'This quarter',
  ytd: 'Year to date',
}

export function presetRange(kind: PresetKind, now: Date): DateRange {
  switch (kind) {
    case 'month':
      return { from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) }
    case 'lastMonth': {
      const prev = subMonths(now, 1)
      return { from: iso(startOfMonth(prev)), to: iso(endOfMonth(prev)) }
    }
    case 'quarter':
      return { from: iso(startOfQuarter(now)), to: iso(endOfQuarter(now)) }
    case 'ytd':
      return { from: iso(startOfYear(now)), to: iso(now) }
  }
}

export function buildPresets(now: Date): PresetMap {
  return {
    month: presetRange('month', now),
    lastMonth: presetRange('lastMonth', now),
    quarter: presetRange('quarter', now),
    ytd: presetRange('ytd', now),
  }
}

// The preset whose range exactly equals {from,to}, or 'custom' if none match.
export function matchPreset(from: string, to: string, presets: PresetMap): PresetKind | 'custom' {
  for (const kind of Object.keys(presets) as PresetKind[]) {
    if (presets[kind].from === from && presets[kind].to === to) return kind
  }
  return 'custom'
}
