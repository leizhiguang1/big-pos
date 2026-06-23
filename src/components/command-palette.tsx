'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { getCommandItems, type CommandItem } from '@/data/search-actions'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CommandItem[]>([])
  const loadedRef = useRef(false)
  const router = useRouter()

  // Load items on first open
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true
      getCommandItems()
        .then(setItems)
        .catch(() => {
          // Let the next open retry rather than staying permanently empty.
          loadedRef.current = false
        })
    }
  }, [open])

  // Keyboard shortcut + custom event listener
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    const onCustomOpen = () => setOpen(true)

    window.addEventListener('keydown', onKeydown)
    window.addEventListener('command-palette:open', onCustomOpen)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('command-palette:open', onCustomOpen)
    }
  }, [])

  const handleSelect = (item: CommandItem) => {
    router.push(item.href)
    setOpen(false)
  }

  const invoices = items.filter(i => i.type === 'invoice')
  const customers = items.filter(i => i.type === 'customer')
  const products = items.filter(i => i.type === 'product')

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Command.Input
          placeholder="Search invoices, clinics, products…"
          className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No results.
        </Command.Empty>

        {invoices.length > 0 && (
          <Command.Group
            heading="Invoices"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {invoices.map(item => (
              <Command.Item
                key={item.id}
                value={`${item.label} ${item.sublabel}`}
                onSelect={() => handleSelect(item)}
                className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm aria-selected:bg-primary/5 data-[selected=true]:bg-primary/5"
              >
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {customers.length > 0 && (
          <Command.Group
            heading="Clinics"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {customers.map(item => (
              <Command.Item
                key={item.id}
                value={`${item.label} ${item.sublabel}`}
                onSelect={() => handleSelect(item)}
                className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm aria-selected:bg-primary/5 data-[selected=true]:bg-primary/5"
              >
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {products.length > 0 && (
          <Command.Group
            heading="Products"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {products.map(item => (
              <Command.Item
                key={item.id}
                value={`${item.label} ${item.sublabel}`}
                onSelect={() => handleSelect(item)}
                className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm aria-selected:bg-primary/5 data-[selected=true]:bg-primary/5"
              >
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
