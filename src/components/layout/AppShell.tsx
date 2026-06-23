'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Settings, LogOut, Menu, X, ChevronRight, Search,
  PanelLeftClose, PanelLeftOpen, UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/AuthContext'
import { mainNav, settingsGroups, guardFor, type NavEntry } from '@/domain/navigation'
import { cn } from '@/lib/utils'
import CommandPalette from '@/components/command-palette'

function SidebarTooltip({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: React.ReactElement
}) {
  if (!collapsed) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

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
  collapsed,
  onToggleCollapsed,
}: {
  items: NavEntry[]
  activeHref: string
  showSettings: boolean
  username: string
  roleName: string
  onNavigate: () => void
  onSignOut: () => void
  collapsed: boolean
  onToggleCollapsed?: () => void
}) {
  const linkClass = (active: boolean) =>
    cn(
      'flex h-10 items-center rounded-lg text-sm font-medium transition-colors',
      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
      active
        ? 'bg-white text-primary shadow-sm'
        : 'text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground',
    )

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative flex h-full flex-col">
        <div className={cn('px-5 pt-5 pb-4', collapsed && 'px-3')}>
          <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'justify-start')}>
            {collapsed ? (
              <Image
                src="/chidental-square.png"
                alt="Chi Dental Lab"
                width={40}
                height={40}
                priority
                className="h-10 w-10 object-contain"
              />
            ) : (
              <Image
                src="/chidental-rectangle.png"
                alt="Chi Dental Lab"
                width={180}
                height={48}
                priority
                className="h-auto w-full max-w-[188px] object-contain object-left"
              />
            )}
            {onToggleCollapsed && (
              <SidebarTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} collapsed={collapsed}>
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center rounded-md text-primary-foreground/60 transition-colors hover:bg-white/10 hover:text-primary-foreground',
                    collapsed
                      ? 'h-7 w-7'
                      : 'absolute right-2 top-5 h-7 w-7',
                  )}
                >
                  {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
                </button>
              </SidebarTooltip>
            )}
          </div>
        </div>

        <div className="mx-4 border-t border-white/10" />

        {/* Search button */}
        <div className={cn('px-3 pb-2', collapsed && 'px-2')}>
          <SidebarTooltip label="Search" collapsed={collapsed}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
              className={cn(
                'flex h-10 w-full items-center rounded-lg border border-white/15 bg-white/5 text-sm text-primary-foreground/60 transition-colors hover:bg-white/10 hover:text-primary-foreground/90',
                collapsed ? 'justify-center px-0' : 'gap-2 px-3',
              )}
            >
              <Search className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Search…</span>
                  <kbd className="hidden items-center gap-0.5 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-xs text-primary-foreground/60 sm:inline-flex">
                    ⌘K
                  </kbd>
                </>
              )}
            </button>
          </SidebarTooltip>
        </div>

        {/* Daily-work nav */}
        <nav className={cn('flex-1 space-y-1 p-3', collapsed && 'px-2')}>
          {items.map(({ href, icon: Icon, label }) => (
            <SidebarTooltip key={href} label={label} collapsed={collapsed}>
              <Link href={href} onClick={onNavigate} className={linkClass(href === activeHref)} aria-label={label}>
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span>{label}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
                  </>
                )}
              </Link>
            </SidebarTooltip>
          ))}
        </nav>

        {/* Settings pinned at the bottom — only when the user can reach a section */}
        {showSettings && (
          <div className={cn('px-3 pb-1', collapsed && 'px-2')}>
            <SidebarTooltip label="Settings" collapsed={collapsed}>
              <Link href="/settings" onClick={onNavigate} className={linkClass(activeHref === '/settings')} aria-label="Settings">
                <Settings className="h-4 w-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span>Settings</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
                  </>
                )}
              </Link>
            </SidebarTooltip>
          </div>
        )}

        <div className="mx-4 border-t border-white/10" />

        {/* User chip → Profile (click yourself), with Sign out */}
        <div className={cn('p-3', collapsed && 'px-2')}>
          <SidebarTooltip label={`${username} · ${roleName}`} collapsed={collapsed}>
            <Link
              href="/profile"
              onClick={onNavigate}
              aria-label="My Profile"
              className={cn(
                'mb-1 rounded-lg transition-colors',
                collapsed ? 'flex h-10 items-center justify-center px-0' : 'block px-3 py-2',
                activeHref === '/profile' ? 'bg-white/10' : 'hover:bg-white/10',
              )}
            >
              {collapsed ? (
                <UserRound className="h-4 w-4 text-primary-foreground/70" />
              ) : (
                <>
                  <p className="text-sm font-medium text-primary-foreground truncate">{username}</p>
                  <p className="text-xs text-primary-foreground/50 capitalize">{roleName}</p>
                </>
              )}
            </Link>
          </SidebarTooltip>
          <SidebarTooltip label="Sign out" collapsed={collapsed}>
            <Button
              variant="ghost"
              size={collapsed ? 'icon' : 'sm'}
              aria-label="Sign out"
              className={cn(
                'text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground',
                collapsed ? 'h-10 w-full' : 'w-full justify-start',
              )}
              onClick={onSignOut}
            >
              <LogOut className={cn('h-4 w-4', !collapsed && 'mr-2')} />
              {!collapsed && 'Sign out'}
            </Button>
          </SidebarTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { username, roleName, hasPermission, isSuperadmin, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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

  useEffect(() => {
    const id = window.setTimeout(() => {
      const stored = window.localStorage.getItem('chidental-sidebar-collapsed')
      if (stored) setSidebarCollapsed(stored === 'true')
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

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
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      window.localStorage.setItem('chidental-sidebar-collapsed', String(next))
      return next
    })
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className={cn('hidden flex-col bg-primary flex-shrink-0 transition-[width] duration-200 md:flex', sidebarCollapsed ? 'w-20' : 'w-64')}>
        <SidebarContent
          items={items}
          activeHref={activeHref}
          showSettings={showSettings}
          username={username}
          roleName={roleName}
          onNavigate={closeSidebar}
          onSignOut={handleSignOut}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeSidebar} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-primary shadow-xl z-50">
            <SidebarContent
              items={items}
              activeHref={activeHref}
              showSettings={showSettings}
              username={username}
              roleName={roleName}
              onNavigate={closeSidebar}
              onSignOut={handleSignOut}
              collapsed={false}
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
          <Image
            src="/chidental-rectangle.png"
            alt="Chi Dental Lab"
            width={154}
            height={41}
            priority
            className="h-9 w-auto object-contain"
          />
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-7">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  )
}
