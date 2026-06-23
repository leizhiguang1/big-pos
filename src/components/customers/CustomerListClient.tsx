'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import type { Column } from '@/lib/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { listViewState } from '@/lib/list-view-state'
import { Plus, Search, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Customer } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'

// Client island for the customers list. The Server Component (`customers/page.tsx`)
// fetches the rows; this component owns the client-side search filter and the
// permission-gated New button — behaviour-identical to the pre-migration page.
export function CustomerListClient({ customers }: { customers: Customer[] }) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return customers.filter(c =>
      c.clinic_name.toLowerCase().includes(q) ||
      (c.contact_person ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q)
    )
  }, [search, customers])

  const columns: Column<Customer>[] = [
    { key: 'clinic', header: 'Clinic', cell: c => <span className="font-medium text-foreground">{c.clinic_name}</span> },
    { key: 'contact', header: 'Contact Person', cell: c => <span className="text-muted-foreground">{c.contact_person ?? '—'}</span> },
    { key: 'phone', header: 'Phone', cell: c => <span className="text-muted-foreground">{c.phone ?? '—'}</span> },
    { key: 'email', header: 'Email', cell: c => <span className="text-muted-foreground">{c.email ?? '—'}</span> },
    { key: 'registered', header: 'Registered', cell: c => <span className="text-sm text-muted-foreground">{formatDate(c.created_at)}</span> },
  ]

  const view = listViewState({ loading: false, total: customers.length, filtered: filtered.length, hasQuery: search.trim() !== '' })
  const emptyState = (
    <EmptyState
      icon={<Users className="h-8 w-8" />}
      title={view === 'empty-no-results' ? 'No clinics match your search' : 'No clinics yet'}
      description={view === 'empty-no-results' ? 'Try a different search term.' : 'Add your first clinic to get started.'}
    />
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clinics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{customers.length} registered</p>
        </div>
        {hasPermission('customers.edit') && (
          <Button asChild>
            <Link href="/customers/new"><Plus className="h-4 w-4 mr-2" />New Clinic</Link>
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search clinic, contact or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={c => c.id}
            onRowClick={c => router.push(`/customers/${c.id}`)}
            empty={emptyState}
          />
        </CardContent>
      </Card>
    </div>
  )
}
