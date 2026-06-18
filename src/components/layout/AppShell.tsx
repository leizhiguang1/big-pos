'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, FileText, Package, BarChart3,
  Wrench, Settings, UserCog, LogOut, Menu, X, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/AuthContext'
import type { Permission } from '@/lib/permissions'
import { COMPANY } from '@/lib/config'
import { cn } from '@/lib/utils'

type NavItem = { href: string; icon: typeof LayoutDashboard; label: string; permission?: Permission }

// `permission` undefined → always visible. Dashboard and Settings stay open
// (Settings only lists sub-sections the role can reach).
const navItems: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/customers', icon: Users, label: 'Customers', permission: 'customers.view' },
  { href: '/invoices', icon: FileText, label: 'Invoices', permission: 'invoices.view' },
  { href: '/work', icon: Wrench, label: 'Work', permission: 'invoices.view' },
  { href: '/products', icon: Package, label: 'Products', permission: 'products.view' },
  { href: '/reports', icon: BarChart3, label: 'Reports', permission: 'reports.view' },
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/settings/employees', icon: UserCog, label: 'Employees', permission: 'staff.manage' },
]

// Deep-link guard: opening one of these paths without the matching view
// permission bounces back to the dashboard. Longest prefix wins so
// /settings/service-statuses is checked before /settings.
const viewGuards: { prefix: string; permission: Permission }[] = [
  { prefix: '/settings/service-statuses', permission: 'services.view' },
  { prefix: '/settings/work-stages', permission: 'settings.manage' },
  { prefix: '/customers', permission: 'customers.view' },
  { prefix: '/invoices', permission: 'invoices.view' },
  { prefix: '/work', permission: 'invoices.view' },
  { prefix: '/products', permission: 'products.view' },
  { prefix: '/reports', permission: 'reports.view' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { username, roleName, hasPermission, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Redirect away from a section the role can't view (deep links, stale tabs).
  useEffect(() => {
    if (loading) return
    const guard = viewGuards.find(g => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`))
    if (guard && !hasPermission(guard.permission)) router.replace('/dashboard')
  }, [loading, pathname, hasPermission, router])

  const items = navItems.filter(i => !i.permission || hasPermission(i.permission))

  // Only the most specific matching item is active, so /settings/employees
  // highlights Employees alone — not Settings as well via its /settings prefix.
  const activeHref = items.reduce((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
    return matches && item.href.length > best.length ? item.href : best
  }, '')

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <img src="/logo-mark.png" alt="" className="w-9 h-9 flex-shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">Chi Dental Lab</p>
          </div>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 p-3 space-y-1">
        {items.map(({ href, icon: Icon, label }) => {
          const isActive = href === activeHref
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
              <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
            </Link>
          )
        })}
      </nav>

      <Separator />

      <div className="p-3">
        <div className="px-3 py-2 mb-1">
          <p className="text-sm font-medium text-gray-700 truncate">{username}</p>
          <p className="text-xs text-gray-400 capitalize">{roleName}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-600 hover:text-red-600 hover:bg-red-50"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-gray-200 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <img src="/logo-mark.png" alt="" className="w-6 h-6 object-contain" />
          <span className="text-sm font-semibold text-gray-900">{COMPANY.name}</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
