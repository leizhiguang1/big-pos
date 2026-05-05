import { supabase } from './supabase'
import type { ServiceStatus } from './database.types'

export const DEFAULT_COLOR = 'bg-gray-100 text-gray-700'

// Notion-style soft pill palette — same family as work-status colors so the
// two badge types feel like one design system on the screen.
export const COLOR_PRESETS: Array<{ name: string; value: string }> = [
  { name: 'Gray',    value: 'bg-gray-100 text-gray-700' },
  { name: 'Blue',    value: 'bg-blue-100 text-blue-700' },
  { name: 'Green',   value: 'bg-green-100 text-green-700' },
  { name: 'Orange',  value: 'bg-orange-100 text-orange-700' },
  { name: 'Amber',   value: 'bg-amber-100 text-amber-700' },
  { name: 'Purple',  value: 'bg-purple-100 text-purple-700' },
  { name: 'Pink',    value: 'bg-pink-100 text-pink-700' },
  { name: 'Red',     value: 'bg-red-100 text-red-700' },
]

export async function fetchActiveServiceStatuses(): Promise<ServiceStatus[]> {
  const { data } = await supabase
    .from('service_statuses')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('label')
  return data ?? []
}
