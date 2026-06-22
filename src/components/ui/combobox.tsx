'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** When true (default) the user may type a value not in `options`. */
  allowCustom?: boolean
  id?: string
  className?: string
}

/**
 * Single-select combobox: a text input with a filtered suggestion list.
 * Selecting a suggestion sets the value; with `allowCustom` the typed text is
 * itself a valid value. Plain React (no portal) so it nests safely in a Dialog.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  allowCustom = true,
  id,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useMemo(() => id ? `${id}-listbox` : undefined, [id])

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const q = value.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        readOnly={!allowCustom}
        onChange={(e) => {
          if (allowCustom) onChange(e.target.value)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Enter' && open) {
            e.preventDefault()
            setOpen(false)
          }
        }}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
      {open && filtered.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-white p-1 text-sm shadow-md">
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                // onMouseDown (not onClick) so selection fires before the input
                // blurs and before the outside-click handler runs.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(opt)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground',
                  opt === value && 'bg-accent/60',
                )}
              >
                <span>{opt}</span>
                {opt === value && <Check className="h-4 w-4 text-green-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
