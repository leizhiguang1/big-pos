import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { Plus, Search } from 'lucide-react'
import type { Customer } from '@/lib/database.types'

export default function CustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filtered, setFiltered] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('customers')
      .select('*')
      .order('clinic_name')
      .then(({ data }) => {
        setCustomers(data ?? [])
        setFiltered(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(
      customers.filter(c =>
        c.clinic_name.toLowerCase().includes(q) ||
        (c.contact_person ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q)
      )
    )
  }, [search, customers])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers.length} registered</p>
        </div>
        <Button asChild>
          <Link to="/customers/new"><Plus className="h-4 w-4 mr-2" />New Customer</Link>
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search clinic, contact or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic / Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">Loading…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">No customers found</TableCell></TableRow>
              )}
              {filtered.map(c => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <TableCell className="font-medium text-gray-900">{c.clinic_name}</TableCell>
                  <TableCell className="text-gray-600">{c.contact_person ?? '—'}</TableCell>
                  <TableCell className="text-gray-600">{c.phone ?? '—'}</TableCell>
                  <TableCell className="text-gray-600">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-gray-400 text-sm">{formatDate(c.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
