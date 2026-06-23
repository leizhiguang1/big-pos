'use client'

// "+ Add item" control for the invoice Line Items section. A button opens a
// browse-first menu of the product catalogue — the list is small and stable, so
// every product is shown at once; an optional filter narrows it. Picking a
// product calls onAdd(product) and keeps the menu open so several lines can be
// added in a row (type → Enter → type → Enter, or just keep clicking).
// Built from primitives because the project has no Command/Combobox/Popover.

import { useEffect, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import type { Product } from '@/lib/database.types'

export function ProductSearchAdd({
  products,
  onAdd,
}: {
  products: Product[]
  onAdd: (product: Product) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const matches = q
    ? products.filter(
        p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      )
    : products

  // Close the menu on an outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Focus the filter as soon as the menu opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function pick(product: Product) {
    onAdd(product)
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus() // stay open for rapid multi-add
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const product = matches[highlight]
      if (product) pick(product)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground',
          open && 'border-primary/40 bg-muted text-foreground',
        )}
      >
        <Plus className="h-4 w-4" />
        Add item
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search products…"
              aria-label="Search products"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-72 overflow-auto py-1" role="listbox">
            {products.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No products yet. Add products first.</div>
            ) : matches.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No products match “{query.trim()}”.</div>
            ) : (
              matches.map((p, idx) => {
                const hasRange = p.min_unit_price != null && p.max_unit_price != null
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={idx === highlight}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(p)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                      idx === highlight ? 'bg-primary/5' : 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                      {p.description && <span className="block truncate text-xs text-muted-foreground">{p.description}</span>}
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="font-medium text-foreground">
                        {hasRange
                          ? `${formatCurrency(p.min_unit_price!)} – ${formatCurrency(p.max_unit_price!)}`
                          : formatCurrency(p.unit_price)}
                      </span>
                      <span className="block text-muted-foreground">/{p.unit}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
