'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { settingsGroups } from '@/domain/navigation'
import { cn } from '@/lib/utils'

// Two-pane Settings shell: a persistent grouped sub-nav on the left, the routed
// section on the right. The rail is derived from the route registry, so it shows
// exactly the sections the user can reach and never needs hand-maintaining.
//
// On mobile the same registry becomes a compact grouped navigation panel so
// settings sections stay visible as real destinations instead of hiding in a
// select menu.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { hasPermission, isSuperadmin, loading } = useAuth()
  const pathname = usePathname()
  const groups = settingsGroups({ hasPermission, isSuperadmin })

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const activeHref = groups.flatMap(({ entries }) => entries).find(({ href }) => isActive(href))?.href

  return (
    <div className="w-full max-w-6xl">
      <div className="mb-4 sm:mb-5">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure the lookups, workflow, and access your lab uses.</p>
      </div>

      {/* Mobile: direct grouped section navigation in place of the desktop rail */}
      {!loading && groups.length > 0 && (
        <nav
          aria-label="Settings sections"
          className="-mx-4 mb-5 border-y border-border/70 bg-card/80 px-4 py-3 shadow-xs sm:-mx-5 sm:px-5 md:hidden"
        >
          <div className="space-y-3">
            {groups.map(({ group, entries }) => (
              <div key={group}>
                <p className="mb-2 px-1 text-xs font-semibold uppercase text-muted-foreground">{group}</p>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
                  {entries.map(({ href, label, icon: Icon }) => {
                    const active = activeHref === href
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors',
                          active
                            ? 'border-primary/35 bg-primary/10 text-primary'
                            : 'border-border/80 bg-background text-muted-foreground hover:border-primary/25 hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="min-w-0 leading-snug">{label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      )}

      <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Sub-nav rail (desktop only) */}
        <nav className="hidden space-y-5 md:block">
          {!loading && groups.map(({ group, entries }) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-2">{group}</p>
              <div className="space-y-1">
                {entries.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href)
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        'flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="min-w-0">{label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Section content */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
