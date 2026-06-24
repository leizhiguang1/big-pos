import { describe, it, expect } from 'vitest'
import { selectableRoles } from './role-filter'

describe('selectableRoles', () => {
  it('excludes system (Super Admin) roles from assignment', () => {
    const roles = [
      { id: '1', name: 'Super Admin', is_system: true },
      { id: '2', name: 'Front Desk', is_system: false },
    ]
    expect(selectableRoles(roles).map(r => r.id)).toEqual(['2'])
  })

  it('keeps a role already assigned even if system, so the current value still renders', () => {
    const roles = [{ id: '1', name: 'Super Admin', is_system: true }]
    expect(selectableRoles(roles, '1').map(r => r.id)).toEqual(['1'])
  })
})
