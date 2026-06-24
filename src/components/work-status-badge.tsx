import { cn } from '@/lib/utils'
import type { WorkStatus } from '@/lib/database.types'
import { workStatusColor, workStatusLabel, type WorkStatusDisplay } from '@/lib/work-status-config'

export function WorkStatusBadge({
  status,
  className,
  children,
  statusConfigs,
}: {
  status: WorkStatus
  className?: string
  children?: React.ReactNode
  statusConfigs?: WorkStatusDisplay[]
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        workStatusColor(status, statusConfigs),
        className
      )}
    >
      {children ?? workStatusLabel(status, statusConfigs)}
    </span>
  )
}
