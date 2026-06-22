// src/lib/data-table.test.ts
import { describe, it, expect } from 'vitest'
import { alignClass } from './data-table'

describe('alignClass', () => {
  it('defaults to left', () => {
    expect(alignClass()).toBe('text-left')
    expect(alignClass('left')).toBe('text-left')
  })
  it('maps right and center', () => {
    expect(alignClass('right')).toBe('text-right')
    expect(alignClass('center')).toBe('text-center')
  })
})
