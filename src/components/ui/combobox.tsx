'use client'

// Searchable single-select combobox. Built from primitives (the project has no
// Command/Popover) and styled to match `ProductSearchAdd`'s browse-first menu:
// a trigger button opens a filterable list; picking an option closes the menu.
// Keyboard: ↑/↓ to move, Enter to pick, Esc to close.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  /** Optional secondary line under the label. */
  hint?: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  /** Extra classes for the dropdown panel — e.g. a min-width when the trigger is narrow. */
  menuClassName?: string
  id?: string
  'aria-label'?: string
  /** Optional compact text for the closed trigger, overriding the selected option's label. */
  triggerLabel?: string
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  className,
  menuClassName,
  id,
  'aria-label': ariaLabel,
  triggerLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value) ?? null

  const q = query.trim().toLowerCase()
  const matches = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
    : options

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Focus the filter when the menu opens. (Highlight is reset by the open
  // toggle and on every query change, so it doesn't need an effect here.)
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function pick(optionValue: string) {
    onChange(optionValue)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      // Pick without bubbling to (and submitting) an enclosing <form>.
      e.preventDefault()
      e.stopPropagation()
      const opt = matches[highlight]
      if (opt) pick(opt.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => { setHighlight(0); setOpen(o => !o) }}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          open && 'ring-2 ring-ring ring-offset-2',
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? (triggerLabel ?? selected.label) : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className={cn('absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl', menuClassName)}>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setHighlight(0) }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-72 overflow-auto py-1" role="listbox">
            {matches.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              matches.map((o, idx) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                    idx === highlight ? 'bg-primary/5' : 'hover:bg-muted',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
