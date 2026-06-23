'use client'

// Shared URL-driven list state for the server-paginated list pages (invoices,
// clinics, products). The page Server Component reads `searchParams` and fetches
// the matching page; this hook lets the client islands MUTATE that URL state —
// search (debounced), saved-view tab, page, and sort — via `router.replace` so
// reloads, back/forward, and link-sharing all reproduce the same view.
//
// Writing through the URL (rather than React state) is the whole point: the
// server re-renders with the new `searchParams`, so the client never filters.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { SortState } from '@/lib/data-table'
import type { ListUrlState } from '@/lib/list-url-state'

// Re-exported so existing client consumers can keep importing the type from
// here. The server-safe parser + type itself live in `./list-url-state`.
export type { ListUrlState } from '@/lib/list-url-state'

export interface UseListUrlState {
  /** Live search box value (instant local echo; pushed to the URL debounced). */
  search: string
  setSearch: (value: string) => void
  /** Switch saved-view tab; resets to page 1. */
  setView: (view: string) => void
  /** Change page (prev/next). */
  setPage: (page: number) => void
  /**
   * Toggle a column's sort. Same key flips asc↔desc; a new key starts at asc.
   * Resets to page 1 so the user lands on the first row of the new ordering.
   */
  toggleSort: (sortKey: string) => void
  /** Active sort for the DataTable, or undefined when nothing is sorted. */
  sort: SortState | undefined
  /** Clear the search box (and its URL param). */
  clearSearch: () => void
  /** Reset the saved view back to its default (drops the `view` param). */
  clearView: () => void
}

/**
 * `state` is the parsed `searchParams` from the server (the source of truth).
 * `defaultView` is the view key that means "no filter" — selecting it drops the
 * `view` param so the canonical URL stays clean.
 */
export function useListUrlState(
  state: ListUrlState,
  defaultView: string,
  { debounceMs = 250 }: { debounceMs?: number } = {},
): UseListUrlState {
  const router = useRouter()
  const pathname = usePathname()

  // Local echo of the search box so typing stays instant; the URL update is
  // debounced behind it.
  const [search, setSearchState] = useState(state.q)
  // Keep the box in sync when the URL changes from elsewhere (back/forward,
  // chip dismissal) without fighting the user's in-flight typing.
  const lastPushedQ = useRef(state.q)
  useEffect(() => {
    if (state.q !== lastPushedQ.current) {
      setSearchState(state.q)
      lastPushedQ.current = state.q
    }
  }, [state.q])

  // Build the next querystring from a partial patch over the current state and
  // replace the URL. Omitting a param (empty / default / page 1) keeps the URL
  // canonical and short.
  const push = useCallback(
    (patch: Partial<ListUrlState>) => {
      const next: ListUrlState = { ...state, ...patch }
      const params = new URLSearchParams()
      if (next.q.trim()) params.set('q', next.q.trim())
      if (next.view && next.view !== defaultView) params.set('view', next.view)
      if (next.page > 1) params.set('page', String(next.page))
      if (next.sort) {
        params.set('sort', next.sort)
        if (next.dir === 'desc') params.set('dir', 'desc')
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [state, defaultView, router, pathname],
  )

  // Debounced search → URL. Resets to page 1 (a new query starts at the top).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        lastPushedQ.current = value.trim()
        push({ q: value, page: 1 })
      }, debounceMs)
    },
    [push, debounceMs],
  )

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const setView = useCallback((view: string) => push({ view, page: 1 }), [push])
  const setPage = useCallback((page: number) => push({ page }), [push])

  const toggleSort = useCallback(
    (sortKey: string) => {
      if (state.sort === sortKey) {
        push({ sort: sortKey, dir: state.dir === 'asc' ? 'desc' : 'asc', page: 1 })
      } else {
        push({ sort: sortKey, dir: 'asc', page: 1 })
      }
    },
    [state.sort, state.dir, push],
  )

  const clearSearch = useCallback(() => {
    setSearchState('')
    lastPushedQ.current = ''
    push({ q: '', page: 1 })
  }, [push])

  const clearView = useCallback(() => push({ view: defaultView, page: 1 }), [push, defaultView])

  return {
    search,
    setSearch,
    setView,
    setPage,
    toggleSort,
    sort: state.sort ? { key: state.sort, dir: state.dir } : undefined,
    clearSearch,
    clearView,
  }
}
