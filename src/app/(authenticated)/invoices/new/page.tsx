'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import type { Customer, Product } from '@/lib/database.types'
import { addDays, format } from 'date-fns'

interface LineItem {
  product_id: string | null
  description: string
  quantity: number
  unit_price: number
}

export default function InvoiceCreatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customerId, setCustomerId] = useState(searchParams.get('customer') ?? '')
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const [patient, setPatient] = useState('')
  const [doctor, setDoctor] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ product_id: null, description: '', quantity: 1, unit_price: 0 }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*').order('clinic_name'),
      supabase.from('products').select('*').eq('active', true).order('name'),
    ]).then(([cRes, pRes]) => {
      setCustomers(cRes.data ?? [])
      setProducts(pRes.data ?? [])
    })
  }, [])

  const updateItem = useCallback((index: number, field: keyof LineItem, value: string | number) => {
    setItems(prev => {
      const updated = [...prev]
      if (field === 'product_id') {
        const product = products.find(p => p.id === value)
        updated[index] = {
          ...updated[index],
          product_id: value as string,
          description: product?.name ?? '',
          unit_price: product?.unit_price ?? 0,
        }
      } else {
        updated[index] = { ...updated[index], [field]: value }
      }
      return updated
    })
  }, [products])

  const addItem = () => setItems(prev => [...prev, { product_id: null, description: '', quantity: 1, unit_price: 0 }])
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const subtotal = items.reduce((s, item) => s + item.quantity * item.unit_price, 0)

  const handleSave = async (status: 'draft' | 'sent') => {
    if (!customerId) { setError('Please select a customer.'); return }
    if (items.every(i => !i.description)) { setError('Add at least one item.'); return }
    setSaving(true)
    setError('')

    const { data: invData, error: invError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: (await supabase.rpc('generate_invoice_number')).data as string,
        customer_id: customerId,
        created_by: user!.id,
        invoice_date: invoiceDate,
        due_date: dueDate,
        status,
        notes: notes || null,
        patient: patient || null,
        doctor: doctor || null,
        subtotal,
        total: subtotal,
      })
      .select()
      .single()

    if (invError || !invData) {
      setError(invError?.message ?? 'Failed to create invoice')
      setSaving(false)
      return
    }

    const itemsPayload = items
      .filter(i => i.description)
      .map(i => ({
        invoice_id: invData.id,
        product_id: i.product_id,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        amount: i.quantity * i.unit_price,
      }))

    await supabase.from('invoice_items').insert(itemsPayload)
    router.push(`/invoices/${invData.id}`)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Invoice</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create and send to customer</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a customer…" />
              </SelectTrigger>
              <SelectContent>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.clinic_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Patient</Label>
              <Input placeholder="Patient name" value={patient} onChange={e => setPatient(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Doctor</Label>
              <Input placeholder="Doctor name" value={doctor} onChange={e => setDoctor(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Line Items</CardTitle>
          <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-4 w-4 mr-2" />Add Item</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 px-1">
            <span className="col-span-5">Description</span>
            <span className="col-span-3">From catalog</span>
            <span className="col-span-1 text-right">Qty</span>
            <span className="col-span-2 text-right">Price (MYR)</span>
            <span className="col-span-1"></span>
          </div>

          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <Input
                className="col-span-5"
                placeholder="Description"
                value={item.description}
                onChange={e => updateItem(i, 'description', e.target.value)}
              />
              <Select
                value={item.product_id ?? ''}
                onValueChange={v => updateItem(i, 'product_id', v)}
              >
                <SelectTrigger className="col-span-3 text-xs">
                  <SelectValue placeholder="Pick catalog…" />
                </SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="col-span-1 text-right"
                type="number"
                min="0.01"
                step="0.01"
                value={item.quantity}
                onChange={e => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
              />
              <Input
                className="col-span-2 text-right"
                type="number"
                min="0"
                step="0.01"
                value={item.unit_price}
                onChange={e => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="col-span-1 h-10 w-10 text-gray-400 hover:text-red-500"
                onClick={() => removeItem(i)}
                disabled={items.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Separator />

          <div className="flex justify-end">
            <div className="w-48 space-y-1">
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            placeholder="Any notes or remarks for this invoice…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={() => handleSave('sent')} disabled={saving}>
          {saving ? 'Saving…' : 'Create & Send'}
        </Button>
        <Button variant="outline" onClick={() => handleSave('draft')} disabled={saving}>
          Save as Draft
        </Button>
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}
