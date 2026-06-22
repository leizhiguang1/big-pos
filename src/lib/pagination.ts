export interface PageResult<T> {
  pageItems: T[]
  /** Page clamped into [1, totalPages]. */
  page: number
  /** Total number of pages, always at least 1. */
  totalPages: number
  /** 1-based index of the first item shown (0 when the list is empty). */
  pageStart: number
  /** 1-based index of the last item shown (0 when the list is empty). */
  pageEnd: number
}

/** Pure slice + clamp math for client-side pagination. */
export function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
  pageSize = Math.max(1, pageSize)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(Math.max(1, page), totalPages)
  const startIndex = (clamped - 1) * pageSize
  const pageItems = items.slice(startIndex, startIndex + pageSize)
  return {
    pageItems,
    page: clamped,
    totalPages,
    pageStart: total === 0 ? 0 : startIndex + 1,
    pageEnd: startIndex + pageItems.length,
  }
}
