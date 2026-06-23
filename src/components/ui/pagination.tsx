'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PaginationProps {
  page: number
  totalPages: number
  filteredCount: number
  pageStart: number
  pageEnd: number
  onPageChange: (page: number) => void
  /** Plural noun for the count line, e.g. "products". */
  itemLabel?: string
  className?: string
}

/** Result count + prev/next nav. Nav hides when there is only one page. */
export function Pagination({
  page,
  totalPages,
  filteredCount,
  pageStart,
  pageEnd,
  onPageChange,
  itemLabel = 'results',
  className,
}: PaginationProps) {
  return (
    <div className={cn('flex items-center justify-between text-sm text-muted-foreground', className)}>
      <span>
        {filteredCount === 0
          ? `No ${itemLabel}`
          : `Showing ${pageStart}–${pageEnd} of ${filteredCount} ${itemLabel}`}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
