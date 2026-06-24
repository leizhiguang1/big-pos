// src/components/ui/data-table.tsx
import * as React from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { alignClass, type Column, type SortState } from '@/lib/data-table'
import { cn } from '@/lib/utils'

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  skeletonRows?: number
  /** Shown (spanning all columns) when not loading and there are no rows. */
  empty?: React.ReactNode
  /** Rendered under the table, e.g. pagination. */
  footer?: React.ReactNode
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  stickyHeader?: boolean
  dense?: boolean
  /** Active sort, for rendering the sort arrow on a column header. */
  sort?: SortState
  /** Called with a column's `sortKey` when its (sortable) header is clicked. */
  onSort?: (sortKey: string) => void
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 6,
  empty,
  footer,
  rowClassName,
  onRowClick,
  stickyHeader = true,
  dense = false,
  sort,
  onSort,
}: DataTableProps<T>) {
  const cellPad = dense ? 'py-2' : 'py-3'
  const showEmpty = !loading && rows.length === 0

  return (
    <div className="w-full overflow-hidden">
      <Table className="min-w-[44rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map(c => {
              // A column opts into sorting via `sortKey`; the table must also be
              // given an `onSort` handler. Otherwise the header renders plainly.
              const sortable = c.sortKey != null && onSort != null
              const active = sortable && sort?.key === c.sortKey
              return (
                <TableHead
                  key={c.key}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(stickyHeader && 'sticky top-0 z-10 bg-card', alignClass(c.align), c.width, c.headClassName)}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort!(c.sortKey!)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                        c.align === 'right' && 'flex-row-reverse',
                        active && 'text-foreground',
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === 'asc'
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                {columns.map(c => (
                  <TableCell key={c.key} className={cellPad}>
                    <Skeleton className="h-4 w-full max-w-[12rem]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}

          {showEmpty && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          )}

          {!loading &&
            rows.map(row => (
              <TableRow
                key={rowKey(row)}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map(c => (
                  <TableCell key={c.key} className={cn(cellPad, alignClass(c.align), c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {footer && <div className="border-t px-3 py-3 sm:px-4">{footer}</div>}
    </div>
  )
}
