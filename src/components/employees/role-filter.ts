export interface SelectableRole { id: string; name: string; is_system: boolean }

// Hide Super Admin (system) roles so no one can promote a person to Super Admin
// via the UI — that stays a code/DB-only action. The currentRoleId escape hatch
// keeps an already-assigned system role visible so the editor renders its value.
export function selectableRoles<T extends SelectableRole>(roles: T[], currentRoleId?: string): T[] {
  return roles.filter(r => !r.is_system || r.id === currentRoleId)
}
