'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ListToolbarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Optional right-slot for extra controls (status/work filters, etc.). */
  children?: React.ReactNode
}

/** Reusable list toolbar: a search box plus an optional right-aligned filter slot. */
export function ListToolbar({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  children,
}: ListToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center', className)}>
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{children}</div>}
    </div>
  )
}
