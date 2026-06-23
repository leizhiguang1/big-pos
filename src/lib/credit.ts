// Display vocabulary for account credits (Wave 6). A credit's `reason` is one
// of `remake | return | goodwill` (see `CreditReason` in database.types.ts).
import type { CreditReason } from '@/lib/database.types'

export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  remake: 'Remake',
  return: 'Return',
  goodwill: 'Goodwill',
}

// The ordered options for the "Issue credit" reason picker.
export const CREDIT_REASON_OPTIONS: { value: CreditReason; label: string }[] = [
  { value: 'remake', label: 'Remake' },
  { value: 'return', label: 'Return' },
  { value: 'goodwill', label: 'Goodwill' },
]

// Safe label lookup for a raw `reason` string coming from the DB (typed `string`).
export function creditReasonLabel(reason: string): string {
  return CREDIT_REASON_LABELS[reason as CreditReason] ?? reason
}
