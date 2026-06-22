'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, cn } from '@/lib/utils'
import { ArrowLeft, ChevronDown, ChevronRight, Minus, Plus, RotateCcw, StickyNote, Tag, Trash2 } from 'lucide-react'
import type { InvoiceStatus, Product } from '@/lib/database.types'
import { addDays, format } from 'date-fns'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { createInvoiceAction, updateInvoiceAction } from '@/data/invoice-actions'
import type { InvoicePayload, InvoiceItemPayload } from '@/data/invoice-actions'
import type { InvoiceFormData, InvoiceForEdit } from '@/data/invoices'
import { ProductSearchAdd } from './ProductSearchAdd'

interface LineItem {
  id: string | null            // existing invoice_items.id, or null for a new row
  product_id: string | null
  description: string          // prints on the invoice; defaults to the product name
  quantity: number
  unit_price: number
  work_note: string            // internal lab remark (invoice_items.work_note); not shown to customer
}

// A customer's delivery address is "different" only when it is present AND not
// identical to the billing address — drives the default state of the toggle.
function deliveryDiffersFromBilling(delivery: string | null | undefined, billing: string | null | undefined): boolean {
  const d = (delivery ?? '').trim()
  return d !== '' && d !== (billing ?? '').trim()
}

export default function InvoiceForm({
  invoiceId,
  formData,
  editData,
}: {
  invoiceId?: string
  formData: InvoiceFormData
  editData?: InvoiceForEdit
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission, loading: authLoading } = useAuth()
  const { show } = useToast()
  const isEdit = Boolean(invoiceId)

  // Reference data arrives from the server wrapper as props.
  const { customers, products, serviceStatuses } = formData
  const editInvoice = editData?.invoice ?? null

  const [customerId, setCustomerId] = useState(editInvoice?.customer_id ?? searchParams.get('customer') ?? '')
  const [invoiceDate, setInvoiceDate] = useState(editInvoice?.invoice_date ?? format(new Date(), 'yyyy-MM-dd'))
  const [dueDate, setDueDate] = useState(
    editInvoice ? (editInvoice.due_date ?? '') : format(addDays(new Date(), 30), 'yyyy-MM-dd'),
  )
  const [notes, setNotes] = useState(editInvoice?.notes ?? '')
  const [patient, setPatient] = useState(editInvoice?.patient ?? '')
  const [doctor, setDoctor] = useState(editInvoice?.doctor ?? '')
  const [serviceStatusId, setServiceStatusId] = useState<string | null>(editInvoice?.service_status_id ?? null)
  const [items, setItems] = useState<LineItem[]>(() =>
    (editData?.items ?? []).map(r => ({
      id: r.id,
      product_id: r.product_id,
      description: r.description,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      work_note: r.work_note ?? '',
    })),
  )
  const [billToName, setBillToName] = useState(editInvoice?.bill_to_name ?? '')
  const [billToContact, setBillToContact] = useState(editInvoice?.bill_to_contact ?? '')
  const [billToPhone, setBillToPhone] = useState(editInvoice?.bill_to_phone ?? '')
  const [billingAddress, setBillingAddress] = useState(editInvoice?.billing_address ?? '')
  const [shipToName, setShipToName] = useState(editInvoice?.ship_to_name ?? '')
  const [shipToContact, setShipToContact] = useState(editInvoice?.ship_to_contact ?? '')
  const [deliveryAddress, setDeliveryAddress] = useState(editInvoice?.delivery_address ?? '')
  // When unchecked, deliver-to == bill-to: the Deliver To fields are hidden and
  // persisted as null, which the invoice document renders as a single Bill-To column.
  const [shipDifferent, setShipDifferent] = useState<boolean>(Boolean(editInvoice?.delivery_address?.trim()))
  const [showRecipient, setShowRecipient] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Status of the loaded invoice (edit mode) — drives the edit lock guard + banner.
  const [loadedStatus] = useState<InvoiceStatus | null>(
    editInvoice ? (editInvoice.status as InvoiceStatus) : null,
  )
  // Void (soft-delete) marker of the loaded invoice — voided invoices are locked for everyone.
  const [loadedVoidedAt] = useState<string | null>(editInvoice?.voided_at ?? null)

  // The customer id whose recipient defaults are already reflected in the form.
  // Guards the auto-fill effect so it doesn't clobber an invoice's saved recipient on load.
  // In edit mode we pre-seed it with the loaded invoice's customer so the saved
  // recipient values survive the initial render of the auto-fill effect.
  const recipientSyncRef = useRef<string | null>(editInvoice?.customer_id ?? null)

  const selectedCustomer = customers.find(c => c.id === customerId) ?? null

  // Edit lock: staff may only edit drafts; admins may edit any non-void invoice.
  // Deep-links to a locked invoice are redirected back to its detail page.
  useEffect(() => {
    if (!isEdit || authLoading || loadedStatus === null) return
    if (!canEditInvoice({ status: loadedStatus, voided_at: loadedVoidedAt }, hasPermission)) {
      router.replace(`/invoices/${invoiceId}`)
    }
  }, [isEdit, authLoading, loadedStatus, loadedVoidedAt, hasPermission, invoiceId, router])

  // When the user picks a (different) customer, fill the recipient block from that
  // customer's master record. Deliberate external-sync effect: it must also run
  // once `customers` finishes loading for a URL-preselected customer, so the logic
  // can't live solely in the Select's onChange. The ref guard skips the initial
  // edit-mode load so saved recipients aren't clobbered, and the grouped setState
  // calls batch into a single render — no cascading-render problem here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (customers.length === 0 && customerId) return
    if (recipientSyncRef.current === customerId) return
    recipientSyncRef.current = customerId
    const c = customers.find(x => x.id === customerId) ?? null
    if (!c) {
      setBillToName(''); setBillToContact(''); setBillToPhone(''); setBillingAddress('')
      setShipToName(''); setShipToContact(''); setDeliveryAddress(''); setShipDifferent(false)
      return
    }
    setBillToName(c.clinic_name ?? '')
    setBillToContact(c.contact_person ?? '')
    setBillToPhone(c.phone ?? '')
    setBillingAddress(c.billing_address ?? '')
    setShipToName(c.clinic_name ?? '')
    setShipToContact(c.contact_person ?? '')
    setDeliveryAddress(c.delivery_address ?? '')
    setShipDifferent(deliveryDiffersFromBilling(c.delivery_address, c.billing_address))
  }, [customerId, customers])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    setShipDifferent(deliveryDiffersFromBilling(selectedCustomer.delivery_address, selectedCustomer.billing_address))
  }

  // Toggling "deliver to a different address" on: seed the recipient name/contact
  // from Bill To so the user only has to type the new address.
  const handleShipDifferentChange = (checked: boolean) => {
    setShipDifferent(checked)
    if (checked && !shipToName.trim() && !shipToContact.trim()) {
      setShipToName(billToName)
      setShipToContact(billToContact)
    }
  }

  const currentServiceStatus = serviceStatuses.find(s => s.id === serviceStatusId) ?? null

  const updateItem = useCallback((index: number, field: keyof LineItem, value: string | number | null) => {
    setItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  // Product-first add: a picked product seeds the line (description = name,
  // price = catalog default). Picking the same product twice adds a second line.
  const addProduct = useCallback((p: Product) => {
    setItems(prev => [
      ...prev,
      { id: null, product_id: p.id, description: p.name, quantity: 1, unit_price: p.unit_price, work_note: '' },
    ])
  }, [])

  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i))

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

  const invoicePayload = (): InvoicePayload => ({
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
    // When "deliver to a different address" is off, persist no ship-to: the
    // invoice document then renders Bill To as a single full-width column.
    ship_to_name: shipDifferent ? (shipToName.trim() || null) : null,
    ship_to_contact: shipDifferent ? (shipToContact.trim() || null) : null,
    delivery_address: shipDifferent ? (deliveryAddress.trim() || null) : null,
    subtotal,
    total: subtotal,
  })

  const validate = () => {
    if (!customerId) { setError('Please select a customer.'); return false }
    if (!invoiceDate || !dueDate) { setError('Invoice date and due date are required.'); return false }
    if (items.length === 0) { setError('Add at least one item.'); return false }
    if (items.some(i => !i.description.trim())) { setError('Every line needs a description.'); return false }
    if (items.some(i => !(i.quantity > 0))) { setError('Quantity must be greater than 0.'); return false }
    if (hasItemPriceErrors) { setError('Some line items are outside the allowed price range.'); return false }
    return true
  }

  const handleCreate = async (status: 'draft' | 'sent') => {
    if (!validate()) return
    setSaving(true)
    setError('')

    const itemsPayload: InvoiceItemPayload[] = items
      .filter(i => i.description.trim())
      .map(i => ({
        product_id: i.product_id,
        description: i.description.trim(),
        quantity: i.quantity,
        unit_price: i.unit_price,
        amount: i.quantity * i.unit_price,
        work_note: i.work_note.trim() || null,
      }))

    // Single transactional action: invoice header + all items succeed or fail
    // together. The action injects created_by; status comes from the caller.
    const result = await createInvoiceAction({
      p_invoice: { ...invoicePayload(), status },
      p_items: itemsPayload,
    })

    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      setSaving(false)
      return
    }
    show({ variant: 'success', title: 'Invoice created' })
    router.push(`/invoices/${result.id}`)
  }

  const handleUpdate = async () => {
    if (!invoiceId || !validate()) return
    setSaving(true)
    setError('')

    // The action diffs items by id: rows with an id are updated, rows without are
    // inserted, and any previously-saved id absent from this list is deleted —
    // all inside one transaction.
    const itemsPayload: InvoiceItemPayload[] = items
      .filter(i => i.description.trim())
      .map(i => ({
        id: i.id,
        product_id: i.product_id,
        description: i.description.trim(),
        quantity: i.quantity,
        unit_price: i.unit_price,
        amount: i.quantity * i.unit_price,
        work_note: i.work_note.trim() || null,
      }))

    const result = await updateInvoiceAction(invoiceId, {
      p_invoice: invoicePayload(),
      p_items: itemsPayload,
    })
    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      setSaving(false)
      return
    }
    show({ variant: 'success', title: 'Invoice updated' })
    router.push(`/invoices/${invoiceId}`)
  }

  // While auth resolves (edit mode) or a locked invoice redirects away, hold on
  // the spinner so the editable form never flashes before the lock decision.
  const blocked = isEdit && (authLoading || (loadedStatus !== null && !canEditInvoice({ status: loadedStatus, voided_at: loadedVoidedAt }, hasPermission)))

  if (blocked) {
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
          You&rsquo;re editing a <span className="font-semibold capitalize">{loadedStatus}</span> invoice. Changes affect a document that has already been sent.
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
                <div className="border-t border-gray-200 p-3 space-y-4">
                  {/* Bill To */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bill To</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input className="bg-white" value={billToName} onChange={e => setBillToName(e.target.value)} placeholder="Recipient name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Contact person</Label>
                        <Input className="bg-white" value={billToContact} onChange={e => setBillToContact(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Phone</Label>
                        <Input className="bg-white" value={billToPhone} onChange={e => setBillToPhone(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Address</Label>
                        <Textarea className="bg-white" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} rows={2} placeholder="Billing address" />
                      </div>
                    </div>
                  </div>

                  {/* Deliver-to toggle */}
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                    <Checkbox checked={shipDifferent} onCheckedChange={v => handleShipDifferentChange(v === true)} />
                    Deliver to a different address
                  </label>

                  {/* Deliver To (only when it differs from billing) */}
                  {shipDifferent && (
                    <div className="space-y-2 rounded-md border border-dashed border-gray-300 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Deliver To</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Name</Label>
                          <Input className="bg-white" value={shipToName} onChange={e => setShipToName(e.target.value)} placeholder="Recipient name" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Contact person</Label>
                          <Input className="bg-white" value={shipToContact} onChange={e => setShipToContact(e.target.value)} placeholder="Optional" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">Address</Label>
                          <Textarea className="bg-white" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} rows={2} placeholder="Delivery address" />
                        </div>
                      </div>
                    </div>
                  )}

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
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductSearchAdd products={products} onAdd={addProduct} />

          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
              Search your products above to start adding lines.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, i) => {
                const product = item.product_id ? products.find(p => p.id === item.product_id) : null
                const hasRange = product?.min_unit_price != null && product?.max_unit_price != null
                // A catalog product with no min/max range is a fixed-price item: price is locked.
                const isFixed = product != null && !hasRange
                const priceError = itemPriceErrors[i]
                const lineTotal = item.quantity * item.unit_price
                return (
                  <div key={item.id ?? `new-${i}`} className="space-y-2.5 rounded-lg border border-gray-200 bg-white p-3">
                    {/* Description (prints on the invoice) — inline-editable, defaults to the product name. */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 hover:bg-gray-50 focus:bg-gray-50 focus:ring-1 focus:ring-gray-200"
                          value={item.description}
                          placeholder="Item description"
                          onChange={e => updateItem(i, 'description', e.target.value)}
                          aria-label="Line description"
                        />
                        {product && (
                          <span className="ml-1 mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
                            <Tag className="h-3 w-3" />
                            {product.name}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-gray-300 hover:text-red-500"
                        onClick={() => removeItem(i)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Qty · unit price · line total */}
                    <div className="flex flex-wrap items-end gap-x-5 gap-y-2 pl-1">
                      <div className="space-y-1">
                        <span className="block text-xs text-gray-400">Qty</span>
                        <div className="flex items-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-r-none"
                            onClick={() => updateItem(i, 'quantity', Math.max(1, item.quantity - 1))}
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <Input
                            className="h-9 w-12 rounded-none border-x-0 text-center"
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={e => updateItem(i, 'quantity', Math.max(1, Math.floor(parseFloat(e.target.value) || 1)))}
                            aria-label="Quantity"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-l-none"
                            onClick={() => updateItem(i, 'quantity', item.quantity + 1)}
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="block text-xs text-gray-400">Unit price (MYR)</span>
                        {isFixed ? (
                          <div className="flex h-9 items-center text-sm text-gray-600">
                            {formatCurrency(item.unit_price)}
                            <span className="ml-1.5 text-xs text-gray-400">fixed</span>
                          </div>
                        ) : (
                          <Input
                            className={cn('h-9 w-28 text-right', priceError && 'border-destructive focus-visible:ring-destructive')}
                            type="number"
                            min={hasRange ? product!.min_unit_price! : 0}
                            max={hasRange ? product!.max_unit_price! : undefined}
                            step="0.01"
                            value={item.unit_price}
                            aria-invalid={priceError ? true : undefined}
                            onChange={e => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                            aria-label="Unit price"
                          />
                        )}
                      </div>

                      <div className="ml-auto space-y-1 text-right">
                        <span className="block text-xs text-gray-400">Line total</span>
                        <div className="flex h-9 items-center justify-end text-sm font-semibold text-gray-900">
                          {formatCurrency(lineTotal)}
                        </div>
                      </div>
                    </div>

                    {/* Price guidance / validation */}
                    {priceError ? (
                      <p className="pl-1 text-xs text-destructive">{priceError}</p>
                    ) : hasRange ? (
                      <p className="pl-1 text-xs text-gray-400">
                        Allowed {formatCurrency(product!.min_unit_price!)} – {formatCurrency(product!.max_unit_price!)}
                      </p>
                    ) : null}

                    {/* Internal remark (lab note) — captured to work_note, not shown to the customer. */}
                    <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2">
                      <StickyNote className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                      <input
                        className="w-full bg-transparent text-xs text-gray-600 outline-none placeholder:text-gray-300"
                        value={item.work_note}
                        placeholder="Internal remark for the lab (optional — not shown to customer)"
                        onChange={e => updateItem(i, 'work_note', e.target.value)}
                        aria-label="Internal remark"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {items.length > 0 && (
            <>
              <Separator />
              <div className="flex justify-end">
                <div className="w-48 space-y-1">
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
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
