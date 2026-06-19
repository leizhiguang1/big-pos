'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { settingsGroups } from '@/domain/navigation'
import { cn } from '@/lib/utils'

// Two-pane Settings shell: a persistent grouped sub-nav on the left, the routed
// section on the right. The rail is derived from the route registry, so it shows
// exactly the sections the user can reach and never needs hand-maintaining.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { hasPermission, isSuperadmin, loading } = useAuth()
  const pathname = usePathname()
  const groups = settingsGroups({ hasPermission, isSuperadmin })

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure the lookups, workflow, and access your lab uses.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sub-nav rail */}
        <nav className="md:w-56 flex-shrink-0 space-y-5">
          {!loading && groups.map(({ group, entries }) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-2">{group}</p>
              <div className="space-y-1">
                {entries.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`)
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Section content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
