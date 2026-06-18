import { describe, it, expect } from 'vitest'
import { permissionGranted, wouldRemoveLastSuperadmin, PERMISSIONS, PERMISSION_GROUPS } from './permissions'

describe('permissionGranted', () => {
  it('grants everything to a system (superadmin) role', () => {
    expect(permissionGranted({ is_system: true, permissions: [] }, 'invoices.manage')).toBe(true)
  })
  it('grants a permission the role holds', () => {
    expect(permissionGranted({ is_system: false, permissions: ['invoices.manage'] }, 'invoices.manage')).toBe(true)
  })
  it('denies a permission the role lacks', () => {
    expect(permissionGranted({ is_system: false, permissions: ['invoices.edit'] }, 'invoices.manage')).toBe(false)
  })
})

describe('wouldRemoveLastSuperadmin', () => {
  it('blocks when the target is the only active superadmin and is losing it', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u1', false)).toBe(true)
  })
  it('allows when another active superadmin remains', () => {
    expect(wouldRemoveLastSuperadmin(['u1', 'u2'], 'u1', false)).toBe(false)
  })
  it('allows when the target keeps superadmin', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u1', true)).toBe(false)
  })
  it('allows when the target was not a superadmin', () => {
    expect(wouldRemoveLastSuperadmin(['u1'], 'u2', false)).toBe(false)
  })
})

describe('permission catalogue', () => {
  it('has 12 permissions across the groups', () => {
    const all = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key))
    expect(all.length).toBe(12)
    expect(new Set(all).size).toBe(12)
    expect(Object.values(PERMISSIONS).length).toBe(12)
  })
})
