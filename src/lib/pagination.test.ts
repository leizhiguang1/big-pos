import { describe, it, expect } from 'vitest'
import { paginate } from './pagination'

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('paginate', () => {
  it('handles an empty list', () => {
    const r = paginate([], 1, 10)
    expect(r.pageItems).toEqual([])
    expect(r.totalPages).toBe(1)
    expect(r.page).toBe(1)
    expect(r.pageStart).toBe(0)
    expect(r.pageEnd).toBe(0)
  })
  it('returns the first page', () => {
    const r = paginate(range(13), 1, 10)
    expect(r.pageItems).toHaveLength(10)
    expect(r.totalPages).toBe(2)
    expect(r.pageStart).toBe(1)
    expect(r.pageEnd).toBe(10)
  })
  it('returns a partial last page', () => {
    const r = paginate(range(13), 2, 10)
    expect(r.pageItems).toEqual([11, 12, 13])
    expect(r.pageStart).toBe(11)
    expect(r.pageEnd).toBe(13)
  })
  it('clamps a page above the range', () => {
    const r = paginate(range(13), 5, 10)
    expect(r.page).toBe(2)
    expect(r.pageItems).toEqual([11, 12, 13])
  })
  it('clamps a page below 1', () => {
    const r = paginate(range(13), 0, 10)
    expect(r.page).toBe(1)
    expect(r.pageStart).toBe(1)
  })
  it('treats a non-positive pageSize as 1', () => {
    const r = paginate([1, 2, 3], 1, 0)
    expect(r.pageItems).toEqual([1])
    expect(r.totalPages).toBe(3)
    expect(r.pageStart).toBe(1)
    expect(r.pageEnd).toBe(1)
  })
})
