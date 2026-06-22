// src/components/ui/data-table.tsx
import * as React from 'react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { alignClass, type Column } from '@/lib/data-table'
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
  stickyHeader?: boolean
  dense?: boolean
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
  stickyHeader = true,
  dense = false,
}: DataTableProps<T>) {
  const cellPad = dense ? 'py-2' : 'py-3'
  const showEmpty = !loading && rows.length === 0

  return (
    <div className="w-full overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map(c => (
              <TableHead
                key={c.key}
                className={cn(stickyHeader && 'sticky top-0 z-10 bg-card', alignClass(c.align), c.width, c.headClassName)}
              >
                {c.header}
              </TableHead>
            ))}
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
              <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map(c => (
                  <TableCell key={c.key} className={cn(cellPad, alignClass(c.align), c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {footer && <div className="border-t px-4 py-3">{footer}</div>}
    </div>
  )
}
