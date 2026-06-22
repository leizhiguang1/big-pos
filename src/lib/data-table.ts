// src/lib/data-table.ts
import type { ReactNode } from 'react'

export type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  /** Stable key for React + column identity. */
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: Align
  /** Extra classes for the body cell. */
  className?: string
  /** Extra classes for the header cell. */
  headClassName?: string
  /** Tailwind width class for the column, e.g. 'w-24'. */
  width?: string
}

export function alignClass(align: Align = 'left'): 'text-left' | 'text-right' | 'text-center' {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}
