// Single source of truth for every navigable destination in the app. The
// sidebar, the settings sub-nav, and the deep-link access guards all derive
// from this one list — add a feature once and it appears (and is gated)
// everywhere. A permission gates a RESOURCE, never the "Settings" container:
// Settings visibility is derived (it shows iff the user can reach ≥1 section).
//
// Profile (/profile) is intentionally NOT in this registry — it is the user's
// own page, reached from the user chip, available to everyone. Keeping it out
// is what lets Settings hide for non-config users without hiding Profile.
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, FileText, Wrench, Package, BarChart3,
  ClipboardList, ListChecks, UserCog, ShieldCheck,
} from 'lucide-react'
import type { Permission } from '@/domain/permissions'

export type NavArea = 'main' | 'settings'

export type NavEntry = {
  href: string
  label: string
  icon: LucideIcon
  area: NavArea
  permission?: Permission   // undefined = visible to all authenticated users
  group?: string            // settings-area grouping label
  superadminOnly?: boolean  // system-role gate (Roles) — not a grantable permission
}

export type NavContext = {
  hasPermission: (p: Permission) => boolean
  isSuperadmin: boolean
}

export const NAV: NavEntry[] = [
  // Daily work — the sidebar.
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, area: 'main' },
  { href: '/customers', label: 'Customers', icon: Users, area: 'main', permission: 'customers.view' },
  { href: '/invoices', label: 'Invoices', icon: FileText, area: 'main', permission: 'invoices.view' },
  { href: '/work', label: 'Work', icon: Wrench, area: 'main', permission: 'invoices.view' },
  { href: '/products', label: 'Products', icon: Package, area: 'main', permission: 'products.view' },
  { href: '/reports', label: 'Reports', icon: BarChart3, area: 'main', permission: 'reports.view' },

  // Configuration & administration — inside Settings.
  { href: '/settings/service-statuses', label: 'Service Statuses', icon: ClipboardList, area: 'settings', group: 'Lab Setup', permission: 'settings.manage' },
  { href: '/settings/work-stages', label: 'Work Stages', icon: ListChecks, area: 'settings', group: 'Lab Setup', permission: 'settings.manage' },
  { href: '/settings/employees', label: 'Employees', icon: UserCog, area: 'settings', group: 'Team & Access', permission: 'staff.manage' },
  { href: '/settings/roles', label: 'Roles & Permissions', icon: ShieldCheck, area: 'settings', group: 'Team & Access', superadminOnly: true },
]

export function canSee(entry: NavEntry, ctx: NavContext): boolean {
  if (entry.superadminOnly) return ctx.isSuperadmin
  return !entry.permission || ctx.hasPermission(entry.permission)
}

export function mainNav(ctx: NavContext): NavEntry[] {
  return NAV.filter(e => e.area === 'main' && canSee(e, ctx))
}

// Visible settings sections grouped in declaration order; empty groups dropped.
export function settingsGroups(ctx: NavContext): { group: string; entries: NavEntry[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, NavEntry[]>()
  for (const e of NAV) {
    if (e.area !== 'settings' || !canSee(e, ctx)) continue
    const g = e.group ?? 'Other'
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g) }
    byGroup.get(g)!.push(e)
  }
  return order.map(group => ({ group, entries: byGroup.get(group)! }))
}

// Deep-link guard for a path: the requirement to view it, or null if open.
// Longest matching href wins so /settings/work-stages beats any shorter prefix.
export function guardFor(pathname: string): { permission?: Permission; superadminOnly?: boolean } | null {
  let best: NavEntry | null = null
  for (const e of NAV) {
    if (!e.permission && !e.superadminOnly) continue
    if (pathname === e.href || pathname.startsWith(`${e.href}/`)) {
      if (!best || e.href.length > best.href.length) best = e
    }
  }
  return best ? { permission: best.permission, superadminOnly: best.superadminOnly } : null
}
