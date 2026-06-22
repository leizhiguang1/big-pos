'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Settings, LogOut, Menu, X, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/AuthContext'
import { mainNav, settingsGroups, guardFor, type NavEntry } from '@/domain/navigation'
import { COMPANY } from '@/lib/config'
import { cn } from '@/lib/utils'
import CommandPalette from '@/components/command-palette'

// Declared at module scope (not inside AppShell's render) so the component keeps
// a stable identity across renders — see react-hooks/static-components.
function SidebarContent({
  items,
  activeHref,
  showSettings,
  username,
  roleName,
  onNavigate,
  onSignOut,
}: {
  items: NavEntry[]
  activeHref: string
  showSettings: boolean
  username: string
  roleName: string
  onNavigate: () => void
  onSignOut: () => void
}) {
  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-gray-100 hover:text-foreground',
    )

  return (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <Image src="/logo-mark.png" alt="" width={36} height={36} className="w-9 h-9 flex-shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Chi Dental Lab</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Search button */}
      <div className="px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-muted-foreground hover:bg-gray-100 transition-colors"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground font-sans">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Daily-work nav */}
      <nav className="flex-1 p-3 space-y-1">
        {items.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} onClick={onNavigate} className={linkClass(href === activeHref)}>
            <Icon className="h-4 w-4 flex-shrink-0" />
            {label}
            <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
          </Link>
        ))}
      </nav>

      {/* Settings pinned at the bottom — only when the user can reach a section */}
      {showSettings && (
        <div className="px-3 pb-1">
          <Link href="/settings" onClick={onNavigate} className={linkClass(activeHref === '/settings')}>
            <Settings className="h-4 w-4 flex-shrink-0" />
            Settings
            <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
          </Link>
        </div>
      )}

      <Separator />

      {/* User chip → Profile (click yourself), with Sign out */}
      <div className="p-3">
        <Link
          href="/profile"
          onClick={onNavigate}
          className={cn(
            'block px-3 py-2 mb-1 rounded-lg transition-colors',
            activeHref === '/profile' ? 'bg-primary/10' : 'hover:bg-gray-100',
          )}
        >
          <p className="text-sm font-medium text-muted-foreground truncate">{username}</p>
          <p className="text-xs text-muted-foreground capitalize">{roleName}</p>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-red-600 hover:bg-red-50"
          onClick={onSignOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { username, roleName, hasPermission, isSuperadmin, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const ctx = { hasPermission, isSuperadmin }
  const items = mainNav(ctx)
  const showSettings = settingsGroups(ctx).length > 0

  // Redirect away from a section the role can't view (deep links, stale tabs).
  useEffect(() => {
    if (loading) return
    const guard = guardFor(pathname)
    if (!guard) return
    const denied = guard.superadminOnly ? !isSuperadmin : !!guard.permission && !hasPermission(guard.permission)
    if (denied) router.replace('/dashboard')
  }, [loading, pathname, hasPermission, isSuperadmin, router])

  // Most specific matching destination wins (so /settings/employees highlights
  // Settings, /profile highlights the chip, etc.).
  const candidates = [...items.map(i => i.href), ...(showSettings ? ['/settings'] : []), '/profile']
  const activeHref = candidates.reduce((best, href) => {
    const matches = pathname === href || pathname.startsWith(`${href}/`)
    return matches && href.length > best.length ? href : best
  }, '')

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-card border-r border-border flex-shrink-0">
        <SidebarContent
          items={items}
          activeHref={activeHref}
          showSettings={showSettings}
          username={username}
          roleName={roleName}
          onNavigate={closeSidebar}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeSidebar} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-card shadow-xl z-50">
            <SidebarContent
              items={items}
              activeHref={activeHref}
              showSettings={showSettings}
              username={username}
              roleName={roleName}
              onNavigate={closeSidebar}
              onSignOut={handleSignOut}
            />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <Image src="/logo-mark.png" alt="" width={24} height={24} className="w-6 h-6 object-contain" />
          <span className="text-sm font-semibold text-foreground">{COMPANY.name}</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  )
}
