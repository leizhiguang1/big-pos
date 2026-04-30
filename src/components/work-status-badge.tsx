import { cn } from '@/lib/utils'
import type { WorkStatus } from '@/lib/database.types'
import { WORK_STATUS_COLORS, WORK_STATUS_LABELS } from '@/lib/work-status'

export function WorkStatusBadge({
  status,
  className,
  children,
}: {
  status: WorkStatus
  className?: string
  children?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        WORK_STATUS_COLORS[status],
        className
      )}
    >
      {children ?? WORK_STATUS_LABELS[status]}
    </span>
  )
}
