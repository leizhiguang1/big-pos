'use client'

import { useMemo, useState } from 'react'
import { paginate } from '@/lib/pagination'

export interface UsePaginatedListOptions<T> {
  /** Return true if `item` matches the (already non-empty, trimmed) query. */
  searchFn: (item: T, query: string) => boolean
  pageSize?: number
}

export interface UsePaginatedListResult<T> {
  query: string
  setQuery: (q: string) => void
  page: number
  setPage: (p: number) => void
  pageItems: T[]
  filteredCount: number
  totalPages: number
  pageStart: number
  pageEnd: number
}

/**
 * Client-side search + pagination over an in-memory list. Filters with the
 * given predicate, then slices via `paginate`. Changing the query resets to
 * page 1; an out-of-range page is clamped for display.
 */
export function usePaginatedList<T>(
  items: T[],
  { searchFn, pageSize = 10 }: UsePaginatedListOptions<T>,
): UsePaginatedListResult<T> {
  const [query, setQueryState] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return items
    return items.filter((item) => searchFn(item, q))
  }, [items, query, searchFn])

  const { pageItems, page: clampedPage, totalPages, pageStart, pageEnd } = paginate(
    filtered,
    page,
    pageSize,
  )

  const setQuery = (q: string) => {
    setQueryState(q)
    setPage(1)
  }

  return {
    query,
    setQuery,
    page: clampedPage,
    setPage,
    pageItems,
    filteredCount: filtered.length,
    totalPages,
    pageStart,
    pageEnd,
  }
}
