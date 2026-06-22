'use client'

// Product-first "search to add" control for the invoice Line Items section.
// Typing filters the active product list; picking one calls onAdd(product) and
// keeps focus so several lines can be added in a row (type → Enter → type → Enter).
// Built from the Input primitive + a positioned results list because the project
// has no Command/Combobox/Popover primitive.

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import type { Product } from '@/lib/database.types'

const MAX_RESULTS = 8

export function ProductSearchAdd({
  products,
  onAdd,
}: {
  products: Product[]
  onAdd: (product: Product) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const matches = (q
    ? products.filter(
        p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      )
    : products
  ).slice(0, MAX_RESULTS)

  // Close the results panel on an outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(product: Product) {
    onAdd(product)
    setQuery('')
    setHighlight(0)
    setOpen(true) // stay open so the next product can be added immediately
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true)
      return
    }
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          ref={inputRef}
          className="pl-9"
          placeholder="Search products to add a line…"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search products to add a line"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {products.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">No products yet. Add products first.</div>
          ) : matches.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">
              No products match “{query.trim()}”.
            </div>
          ) : (
            matches.map((p, i) => {
              const hasRange = p.min_unit_price != null && p.max_unit_price != null
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                    i === highlight ? 'bg-gray-100' : 'hover:bg-gray-50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">{p.name}</span>
                    {p.description && (
                      <span className="block truncate text-xs text-gray-400">{p.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-gray-500">
                    {hasRange
                      ? `${formatCurrency(p.min_unit_price!)} – ${formatCurrency(p.max_unit_price!)}`
                      : formatCurrency(p.unit_price)}
                    <span className="block text-gray-400">/{p.unit}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
