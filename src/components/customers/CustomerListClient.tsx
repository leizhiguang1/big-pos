'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import type { Column } from '@/lib/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { FilterChips, type FilterChip } from '@/components/ui/filter-chips'
import { listViewState } from '@/lib/list-view-state'
import { Plus, Search, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useListUrlState, type ListUrlState } from '@/lib/use-list-url-state'
import type { Customer } from '@/lib/database.types'
import type { CustomerListPage } from '@/data/customers'
import { useAuth } from '@/contexts/AuthContext'

// Client island for the clinics list. URL-DRIVEN: the Server Component
// (`customers/page.tsx`) reads `searchParams`, fetches the page via
// `getCustomersPage` (server-side search + sort + pagination), and passes it in;
// this island only mutates the URL state via `useListUrlState`.
export function CustomerListClient({ page, state }: { page: CustomerListPage; state: ListUrlState }) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { search, setSearch, setPage, toggleSort, sort, clearSearch } = useListUrlState(state, '')

  const columns: Column<Customer>[] = [
    { key: 'clinic', header: 'Clinic', sortKey: 'clinic', cell: c => <span className="font-medium text-foreground">{c.clinic_name}</span> },
    { key: 'contact', header: 'Contact Person', sortKey: 'contact', cell: c => <span className="text-muted-foreground">{c.contact_person ?? '—'}</span> },
    { key: 'phone', header: 'Phone', cell: c => <span className="text-muted-foreground">{c.phone ?? '—'}</span> },
    { key: 'email', header: 'Email', cell: c => <span className="text-muted-foreground">{c.email ?? '—'}</span> },
    { key: 'registered', header: 'Registered', sortKey: 'registered', cell: c => <span className="text-sm text-muted-foreground">{formatDate(c.created_at)}</span> },
  ]

  const view = listViewState({ loading: false, total: page.total, filtered: page.total, hasQuery: state.q.trim() !== '' })
  const chips: FilterChip[] = []
  if (state.q.trim() !== '') chips.push({ key: 'search', label: `Search: ${state.q.trim()}`, onRemove: clearSearch })

  const emptyState = (
    <EmptyState
      icon={<Users className="h-8 w-8" />}
      title={view === 'empty-no-results' ? 'No clinics match your search' : 'No clinics yet'}
      description={view === 'empty-no-results' ? 'Try a different search term.' : 'Add your first clinic to get started.'}
    />
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Clinics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{page.total} registered</p>
        </div>
        {hasPermission('customers.edit') && (
          <Button className="w-full sm:w-auto" asChild>
            <Link href="/customers/new"><Plus className="h-4 w-4 mr-2" />New Clinic</Link>
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clinic, contact or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <FilterChips chips={chips} />
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={page.rows}
            rowKey={c => c.id}
            onRowClick={c => router.push(`/customers/${c.id}`)}
            empty={emptyState}
            sort={sort}
            onSort={toggleSort}
            footer={
              <Pagination
                page={page.page}
                totalPages={page.totalPages}
                filteredCount={page.total}
                pageStart={page.pageStart}
                pageEnd={page.pageEnd}
                onPageChange={setPage}
                itemLabel="clinics"
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
