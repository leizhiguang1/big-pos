'use client'

// Sticky footer row for configurable-list dropdowns (Unit, Work Status, Service
// Status, …). Renders a separator + a link to the settings page that manages the
// dropdown's options, so users discover where to edit the list from the exact
// spot they're looking. Opens in a NEW TAB so an in-progress form isn't lost.
// Gated by permission — renders nothing for users who can't edit the list.
import { SlidersHorizontal } from 'lucide-react'
import { SelectSeparator } from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import type { Permission } from '@/domain/permissions'
import { cn } from '@/lib/utils'

type ManageOptionsLinkProps = {
  href: string
  label: string
  permission?: Permission
}

export function ManageOptionsLink({ href, label, permission = 'settings.manage' }: ManageOptionsLinkProps) {
  const { hasPermission } = useAuth()
  if (!hasPermission(permission)) return null

  // window.open in onClick rather than a bare <a target=_blank>: inside a Radix
  // Select the anchor's default navigation can be swallowed by the popup's
  // pointer handling, so we open the tab explicitly. href is kept for
  // right-click / middle-click "open in new tab" semantics.
  return (
    <>
      <SelectSeparator />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          window.open(href, '_blank', 'noopener,noreferrer')
        }}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-none',
          'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
        {label}
      </a>
    </>
  )
}
