// Fixed catalogue of capabilities shipped with the app. Users assign these to
// roles; they cannot invent new ones.
//
// Two tiers:
//  - Operational data modules (invoices, customers, products): `view` gates
//    seeing the section, `edit` gates create/edit/delete. Invoices add `manage`
//    for the powerful actions (void/restore + editing already-sent invoices).
//  - Administration toggles: `reports.view` (view-only), `staff.manage`
//    (employees), and `settings.manage` (all lab configuration — Service
//    Statuses, Work Stages, and future business settings). Role management is
//    NOT a permission here: it is gated to the Super Admin system role to avoid
//    privilege escalation (a "manage roles" perm could grant itself anything).
export const PERMISSIONS = {
  'invoices.view': 'invoices.view',
  'invoices.edit': 'invoices.edit',
  'invoices.manage': 'invoices.manage',
  'customers.view': 'customers.view',
  'customers.edit': 'customers.edit',
  'products.view': 'products.view',
  'products.edit': 'products.edit',
  'reports.view': 'reports.view',
  'staff.manage': 'staff.manage',
  'settings.manage': 'settings.manage',
} as const

export type Permission = keyof typeof PERMISSIONS

// `edit`/`manage` are meaningless without the matching `view` — view is the
// floor. The role editor uses this to keep selections coherent (checking edit
// auto-checks view; unchecking view clears its dependents).
export const PERMISSION_REQUIRES: Partial<Record<Permission, Permission>> = {
  'invoices.edit': 'invoices.view',
  'invoices.manage': 'invoices.view',
  'customers.edit': 'customers.view',
  'products.edit': 'products.view',
}

// Grouping is for display in the role editor only; underneath it is a flat list.
export const PERMISSION_GROUPS: {
  label: string
  permissions: { key: Permission; label: string; description?: string }[]
}[] = [
  {
    label: 'Invoices',
    permissions: [
      { key: 'invoices.view', label: 'View invoices', description: 'See invoices and their line items.' },
      { key: 'invoices.edit', label: 'Create & edit draft invoices', description: 'Make new invoices and edit ones still in draft.' },
      { key: 'invoices.manage', label: 'Void, restore & edit sent invoices', description: 'Powerful actions on invoices already sent to a doctor.' },
    ],
  },
  {
    label: 'Customers',
    permissions: [
      { key: 'customers.view', label: 'View customers', description: 'See the customer/clinic directory.' },
      { key: 'customers.edit', label: 'Add & edit customers', description: 'Create and update customer records.' },
    ],
  },
  {
    label: 'Products',
    permissions: [
      { key: 'products.view', label: 'View products', description: 'See the product & price catalogue.' },
      { key: 'products.edit', label: 'Add & edit products', description: 'Create and update products and prices.' },
    ],
  },
  {
    label: 'Administration',
    permissions: [
      { key: 'reports.view', label: 'View reports', description: 'See revenue and outstanding reports.' },
      { key: 'staff.manage', label: 'Manage employees', description: 'Add staff, reset PINs, assign roles.' },
      { key: 'settings.manage', label: 'Manage lab settings', description: 'Configure Service Statuses, Work Stages and lab defaults.' },
    ],
  },
]

// Pure grant check. A system role (Super Admin) implicitly holds every permission.
export function permissionGranted(
  role: { is_system: boolean; permissions: string[] },
  permission: string,
): boolean {
  return role.is_system || role.permissions.includes(permission)
}

// Lockout guard: true when this change would leave zero active Super Admins.
// `targetStaysSuperadmin` is false when the user is being demoted OR deactivated.
export function wouldRemoveLastSuperadmin(
  activeSuperadminIds: string[],
  targetUserId: string,
  targetStaysSuperadmin: boolean,
): boolean {
  if (targetStaysSuperadmin) return false
  return activeSuperadminIds.length === 1 && activeSuperadminIds[0] === targetUserId
}
