'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Edit, Plus, Phone, Mail, MapPin, Truck } from 'lucide-react'
import type { Customer, Invoice } from '@/lib/database.types'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  draft: 'secondary', sent: 'info', partial: 'warning', paid: 'success', overdue: 'destructive', void: 'secondary',
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('invoices').select('*').eq('customer_id', id).order('invoice_date', { ascending: false }),
    ]).then(([cRes, iRes]) => {
      setCustomer(cRes.data)
      setInvoices(iRes.data ?? [])
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
  if (!customer) return <p className="text-gray-500">Customer not found.</p>

  const totalBilled = invoices.reduce((s, i) => s + Number(i.total), 0)
  const totalOutstanding = invoices
    .filter(i => ['sent', 'partial', 'overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.total), 0)

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{customer.clinic_name}</h1>
            {customer.contact_person && <p className="text-sm text-gray-500 mt-0.5">{customer.contact_person}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/customers/${id}/edit`}><Edit className="h-4 w-4 mr-2" />Edit</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href={`/invoices/new?customer=${id}`}><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm text-gray-500">Contact Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-400" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{customer.email}</span>
              </div>
            )}
            {(customer.billing_address || customer.delivery_address) && (
              <Separator />
            )}
            {customer.billing_address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-0.5">Billing Address</p>
                  <span className="whitespace-pre-line">{customer.billing_address}</span>
                </div>
              </div>
            )}
            {customer.delivery_address && (
              <div className="flex items-start gap-2 text-sm">
                <Truck className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-0.5">Delivery Address</p>
                  <span className="whitespace-pre-line">{customer.delivery_address}</span>
                </div>
              </div>
            )}
            {customer.notes && (
              <>
                <Separator />
                <p className="text-sm text-gray-500 italic">{customer.notes}</p>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-gray-400">Total Billed</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalBilled)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-gray-400">Outstanding</p>
              <p className="text-xl font-bold text-yellow-600 mt-1">{formatCurrency(totalOutstanding)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">No invoices yet</TableCell></TableRow>
              )}
              {invoices.map(inv => (
                <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                  <TableCell className="font-medium text-primary">{inv.invoice_number}</TableCell>
                  <TableCell className="text-gray-500 text-sm">{formatDate(inv.invoice_date)}</TableCell>
                  <TableCell className="text-gray-500 text-sm">{formatDate(inv.due_date)}</TableCell>
                  <TableCell className="font-medium">{formatCurrency(inv.total)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[inv.status] ?? 'secondary'} className="capitalize">{inv.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
