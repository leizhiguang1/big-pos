'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
import { formatCurrency, cn } from '@/lib/utils'
import { ArrowLeft, ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { Customer, Product, ServiceStatus, Invoice, InvoiceItem, InvoiceStatus } from '@/lib/database.types'
import { addDays, format } from 'date-fns'
import { fetchActiveServiceStatuses, DEFAULT_COLOR } from '@/lib/service-status'
import { canEditInvoice } from '@/lib/invoice-permissions'

interface LineItem {
  id: string | null            // existing invoice_items.id, or null for a new row
  product_id: string | null
  description: string
  quantity: number
  unit_price: number
}

const blankItem = (): LineItem => ({ id: null, product_id: null, description: '', quantity: 1, unit_price: 0 })

export default function InvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, role, loading: authLoading } = useAuth()
  const isEdit = Boolean(invoiceId)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatus[]>([])
  const [customerId, setCustomerId] = useState(searchParams.get('customer') ?? '')
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const [patient, setPatient] = useState('')
  const [doctor, setDoctor] = useState('')
  const [serviceStatusId, setServiceStatusId] = useState<string | null>(null)
  const [items, setItems] = useState<LineItem[]>([blankItem()])
  const [billToName, setBillToName] = useState('')
  const [billToContact, setBillToContact] = useState('')
  const [billToPhone, setBillToPhone] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [shipToName, setShipToName] = useState('')
  const [shipToContact, setShipToContact] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [showRecipient, setShowRecipient] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Status of the loaded invoice (edit mode) — drives the edit lock guard + banner.
  const [loadedStatus, setLoadedStatus] = useState<InvoiceStatus | null>(null)

  // Item ids present when the invoice was loaded — used to compute deletes on save.
  const originalItemIdsRef = useRef<string[]>([])
  // The customer id whose recipient defaults are already reflected in the form.
  // Guards the auto-fill effect so it doesn't clobber an invoice's saved recipient on load.
  const recipientSyncRef = useRef<string | null>(null)

  const selectedCustomer = customers.find(c => c.id === customerId) ?? null

  // Load reference data (customers, products, service statuses).
  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*').order('clinic_name'),
      supabase.from('products').select('*').eq('active', true).order('created_at'),
      fetchActiveServiceStatuses(),
    ]).then(([cRes, pRes, ssList]) => {
      setCustomers(cRes.data ?? [])
      setProducts(pRes.data ?? [])
      setServiceStatuses(ssList)
    })
  }, [])

  // Edit mode: preload the invoice and its line items.
  useEffect(() => {
    if (!isEdit || !invoiceId) return
    Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('created_at'),
    ]).then(([invRes, itemsRes]) => {
      const inv = invRes.data as Invoice | null
      if (inv) {
        setLoadedStatus(inv.status)
        setCustomerId(inv.customer_id)
        setInvoiceDate(inv.invoice_date)
        setDueDate(inv.due_date ?? '')
        setNotes(inv.notes ?? '')
        setPatient(inv.patient ?? '')
        setDoctor(inv.doctor ?? '')
        setServiceStatusId(inv.service_status_id)
        setBillToName(inv.bill_to_name ?? '')
        setBillToContact(inv.bill_to_contact ?? '')
        setBillToPhone(inv.bill_to_phone ?? '')
        setBillingAddress(inv.billing_address ?? '')
        setShipToName(inv.ship_to_name ?? '')
        setShipToContact(inv.ship_to_contact ?? '')
        setDeliveryAddress(inv.delivery_address ?? '')
        // Mark this customer as already synced so the auto-fill effect leaves
        // the invoice's saved recipient values untouched.
        recipientSyncRef.current = inv.customer_id
      }
      const rows = (itemsRes.data ?? []) as InvoiceItem[]
      originalItemIdsRef.current = rows.map(r => r.id)
      setItems(
        rows.length > 0
          ? rows.map(r => ({
              id: r.id,
              product_id: r.product_id,
              description: r.description,
              quantity: Number(r.quantity),
              unit_price: Number(r.unit_price),
            }))
          : [blankItem()],
      )
      setLoading(false)
    })
  }, [isEdit, invoiceId])

  // Edit lock: staff may only edit drafts; admins may edit any non-void invoice.
  // Deep-links to a locked invoice are redirected back to its detail page.
  useEffect(() => {
    if (!isEdit || authLoading || loadedStatus === null) return
    if (!canEditInvoice(loadedStatus, role)) {
      router.replace(`/invoices/${invoiceId}`)
    }
  }, [isEdit, authLoading, loadedStatus, role, invoiceId, router])

  // When the user picks a (different) customer, fill the recipient block from
  // that customer's master record. Skipped on initial load in edit mode.
  useEffect(() => {
    if (customers.length === 0 && customerId) return
    if (recipientSyncRef.current === customerId) return
    recipientSyncRef.current = customerId
    const c = customers.find(x => x.id === customerId) ?? null
    if (!c) {
      setBillToName(''); setBillToContact(''); setBillToPhone(''); setBillingAddress('')
      setShipToName(''); setShipToContact(''); setDeliveryAddress('')
      return
    }
    setBillToName(c.clinic_name ?? '')
    setBillToContact(c.contact_person ?? '')
    setBillToPhone(c.phone ?? '')
    setBillingAddress(c.billing_address ?? '')
    setShipToName(c.clinic_name ?? '')
    setShipToContact(c.contact_person ?? '')
    setDeliveryAddress(c.delivery_address ?? '')
  }, [customerId, customers])

  const recipientDirty = selectedCustomer
    ? billToName !== (selectedCustomer.clinic_name ?? '')
      || billToContact !== (selectedCustomer.contact_person ?? '')
      || billToPhone !== (selectedCustomer.phone ?? '')
      || billingAddress !== (selectedCustomer.billing_address ?? '')
      || shipToName !== (selectedCustomer.clinic_name ?? '')
      || shipToContact !== (selectedCustomer.contact_person ?? '')
      || deliveryAddress !== (selectedCustomer.delivery_address ?? '')
    : false

  const restoreFromCustomer = () => {
    if (!selectedCustomer) return
    setBillToName(selectedCustomer.clinic_name ?? '')
    setBillToContact(selectedCustomer.contact_person ?? '')
    setBillToPhone(selectedCustomer.phone ?? '')
    setBillingAddress(selectedCustomer.billing_address ?? '')
    setShipToName(selectedCustomer.clinic_name ?? '')
    setShipToContact(selectedCustomer.contact_person ?? '')
    setDeliveryAddress(selectedCustomer.delivery_address ?? '')
  }

  const currentServiceStatus = serviceStatuses.find(s => s.id === serviceStatusId) ?? null

  const updateItem = useCallback((index: number, field: keyof LineItem, value: string | number | null) => {
    setItems(prev => {
      const updated = [...prev]
      if (field === 'product_id') {
        const product = products.find(p => p.id === value)
        updated[index] = {
          ...updated[index],
          product_id: (value as string) || null,
          description: product?.name ?? updated[index].description,
          unit_price: product?.unit_price ?? updated[index].unit_price,
        }
      } else {
        updated[index] = { ...updated[index], [field]: value }
      }
      return updated
    })
  }, [products])

  const addItem = () => setItems(prev => [...prev, blankItem()])
  const removeItem = (i: number) => setItems(prev => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))

  const subtotal = items.reduce((s, item) => s + item.quantity * item.unit_price, 0)

  const itemPriceErrors = items.map(item => {
    if (!item.product_id) return null
    const p = products.find(x => x.id === item.product_id)
    if (!p || p.min_unit_price == null || p.max_unit_price == null) return null
    if (item.unit_price < p.min_unit_price || item.unit_price > p.max_unit_price) {
      return `Allowed: ${formatCurrency(p.min_unit_price)} – ${formatCurrency(p.max_unit_price)}`
    }
    return null
  })
  const hasItemPriceErrors = itemPriceErrors.some(Boolean)

  const invoicePayload = () => ({
    customer_id: customerId,
    invoice_date: invoiceDate,
    due_date: dueDate,
    notes: notes || null,
    patient: patient || null,
    doctor: doctor || null,
    service_status_id: serviceStatusId,
    bill_to_name: billToName.trim() || null,
    bill_to_contact: billToContact.trim() || null,
    bill_to_phone: billToPhone.trim() || null,
    billing_address: billingAddress.trim() || null,
    ship_to_name: shipToName.trim() || null,
    ship_to_contact: shipToContact.trim() || null,
    delivery_address: deliveryAddress.trim() || null,
    subtotal,
    total: subtotal,
  })

  const validate = () => {
    if (!customerId) { setError('Please select a customer.'); return false }
    if (!invoiceDate || !dueDate) { setError('Invoice date and due date are required.'); return false }
    if (items.every(i => !i.description.trim())) { setError('Add at least one item.'); return false }
    if (items.some(i => i.description.trim() && !(i.quantity > 0))) { setError('Quantity must be greater than 0.'); return false }
    if (hasItemPriceErrors) { setError('Some line items are outside the allowed price range.'); return false }
    return true
  }

  const handleCreate = async (status: 'draft' | 'sent') => {
    if (!validate()) return
    setSaving(true)
    setError('')

    const { data: invData, error: invError } = await supabase
      .from('invoices')
      .insert({ ...invoicePayload(), created_by: user!.id, status })
      .select()
      .single()

    if (invError || !invData) {
      setError(invError?.message ?? 'Failed to create invoice')
      setSaving(false)
      return
    }

    const itemsPayload = items
      .filter(i => i.description.trim())
      .map(i => ({
        invoice_id: (invData as Invoice).id,
        product_id: i.product_id,
        description: i.description.trim(),
        quantity: i.quantity,
        unit_price: i.unit_price,
        amount: i.quantity * i.unit_price,
      }))

    const { error: itemsError } = await supabase.from('invoice_items').insert(itemsPayload)
    if (itemsError) {
      setError(itemsError.message)
      setSaving(false)
      return
    }
    router.push(`/invoices/${(invData as Invoice).id}`)
  }

  const handleUpdate = async () => {
    if (!invoiceId || !validate()) return
    setSaving(true)
    setError('')

    const rows = items.filter(i => i.description.trim())
    const keptIds = new Set(rows.filter(r => r.id).map(r => r.id as string))

    const toDelete = originalItemIdsRef.current.filter(id => !keptIds.has(id))
    const toInsert = rows
      .filter(r => !r.id)
      .map(r => ({
        invoice_id: invoiceId,
        product_id: r.product_id,
        description: r.description.trim(),
        quantity: r.quantity,
        unit_price: r.unit_price,
        amount: r.quantity * r.unit_price,
      }))
    const toUpdate = rows.filter(r => r.id)

    const ops: PromiseLike<{ error: { message: string } | null }>[] = []
    ops.push(supabase.from('invoices').update(invoicePayload()).eq('id', invoiceId))
    if (toDelete.length) ops.push(supabase.from('invoice_items').delete().in('id', toDelete))
    if (toInsert.length) ops.push(supabase.from('invoice_items').insert(toInsert))
    for (const r of toUpdate) {
      ops.push(
        supabase.from('invoice_items').update({
          product_id: r.product_id,
          description: r.description.trim(),
          quantity: r.quantity,
          unit_price: r.unit_price,
          amount: r.quantity * r.unit_price,
        }).eq('id', r.id as string),
      )
    }

    const results = await Promise.all(ops)
    const failed = results.find(res => res.error)
    if (failed?.error) { setError(failed.error.message); setSaving(false); return }

    router.push(`/invoices/${invoiceId}`)
  }

  // While auth resolves or a locked invoice redirects away, hold on the spinner.
  const blocked = isEdit && loadedStatus !== null && !authLoading && !canEditInvoice(loadedStatus, role)

  if (loading || blocked) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Invoice' : 'New Invoice'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{isEdit ? 'Update invoice details and items' : 'Create and send to customer'}</p>
        </div>
      </div>

      {isEdit && loadedStatus && loadedStatus !== 'draft' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You&rsquo;re editing a <span className="font-semibold capitalize">{loadedStatus}</span> invoice (admin override). Changes affect a document that has already been sent.
        </div>
      )}

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

          {selectedCustomer && (
            <div className="rounded-md border border-gray-200 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setShowRecipient(s => !s)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100/50"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  {showRecipient ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium">Recipient details (Bill To / Deliver To)</span>
                  {recipientDirty && !showRecipient && (
                    <span className="text-xs font-medium text-amber-600">Edited</span>
                  )}
                </span>
                {!showRecipient && (
                  <span className="truncate max-w-[260px] text-xs text-gray-500">
                    {billToName || 'No bill-to name'}
                  </span>
                )}
              </button>
              {showRecipient && (
                <div className="border-t border-gray-200 p-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bill To</div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input value={billToName} onChange={e => setBillToName(e.target.value)} placeholder="Recipient name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Contact person</Label>
                        <Input value={billToContact} onChange={e => setBillToContact(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Phone</Label>
                        <Input value={billToPhone} onChange={e => setBillToPhone(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Address</Label>
                        <Textarea value={billingAddress} onChange={e => setBillingAddress(e.target.value)} rows={3} placeholder="Billing address" />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Deliver To</div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input value={shipToName} onChange={e => setShipToName(e.target.value)} placeholder="Recipient name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Contact person</Label>
                        <Input value={shipToContact} onChange={e => setShipToContact(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Address</Label>
                        <Textarea value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} rows={6} placeholder="Delivery address (leave empty to hide Deliver To block)" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-gray-500">Edits apply to this invoice only.</p>
                    {recipientDirty && (
                      <Button type="button" variant="ghost" size="sm" onClick={restoreFromCustomer} className="h-7 text-xs">
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restore from customer
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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

          <div className="space-y-2">
            <Label>Service Status</Label>
            <Select
              value={serviceStatusId ?? '__none__'}
              onValueChange={v => setServiceStatusId(v === '__none__' ? null : v)}
            >
              <SelectTrigger
                className={cn(
                  'h-9 w-56 text-sm font-medium',
                  currentServiceStatus ? cn('border-transparent', currentServiceStatus.color ?? DEFAULT_COLOR) : '',
                )}
              >
                <SelectValue placeholder="No status set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No status</SelectItem>
                {serviceStatuses.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {items.map((item, i) => {
            const product = item.product_id ? products.find(p => p.id === item.product_id) : null
            const hasRange = product?.min_unit_price != null && product?.max_unit_price != null
            const priceError = itemPriceErrors[i]
            return (
              <div key={item.id ?? `new-${i}`} className="grid grid-cols-12 gap-2 items-start">
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
                <div className="col-span-2 space-y-1">
                  <Input
                    className={cn('text-right', priceError && 'border-destructive focus-visible:ring-destructive')}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    aria-invalid={priceError ? true : undefined}
                    onChange={e => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                  />
                  {priceError ? (
                    <p className="text-xs text-destructive text-right">{priceError}</p>
                  ) : hasRange ? (
                    <p className="text-xs text-gray-400 text-right">
                      {formatCurrency(product!.min_unit_price!)} – {formatCurrency(product!.max_unit_price!)}
                    </p>
                  ) : null}
                </div>
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
            )
          })}

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
        {isEdit ? (
          <Button onClick={handleUpdate} disabled={saving || hasItemPriceErrors}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        ) : (
          <>
            <Button onClick={() => handleCreate('sent')} disabled={saving || hasItemPriceErrors}>
              {saving ? 'Saving…' : 'Create & Send'}
            </Button>
            <Button variant="outline" onClick={() => handleCreate('draft')} disabled={saving || hasItemPriceErrors}>
              Save as Draft
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}
