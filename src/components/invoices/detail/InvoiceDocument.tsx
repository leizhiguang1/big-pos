'use client'

// The printable invoice/delivery document plus the two interactive pieces that
// are coupled to its markup: the Bill-To / Deliver-To recipient editor (the
// pencil lives inside the document header) and the unified print dialog (its
// live preview re-renders the same `renderDocBody`). Keeping them together lets
// `renderDocBody` / `resolveFields` stay a single implementation, pixel-identical
// to the original client page.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Printer, Pencil } from 'lucide-react'
import { isVoided } from '@/lib/invoice-status'
import { saveRecipientAction } from '@/data/invoice-actions'
import type { InvoiceItem, Product, ServiceStatus } from '@/lib/database.types'
import type { InvoiceDetail } from '@/data/invoices'
import { COMPANY, BANK } from '@/lib/config'
import { DEFAULT_COLOR } from '@/lib/service-status'

type PrintMode = 'invoice' | 'delivery'

type ItemOverride = {
  description: string
  quantity: number
  unitPrice: number
}

type PrintOverrides = {
  date: string
  dueDate: string
  billToName: string
  billToContact: string
  billToPhone: string
  billingAddress: string
  shipToName: string
  shipToContact: string
  deliveryAddress: string
  patient: string
  doctor: string
  serviceStatusId: string | null
  instructions: string
  itemOverrides: Record<string, ItemOverride>
}

export type InvoiceDocumentProps = {
  invoice: InvoiceDetail
  items: InvoiceItem[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
  currentServiceStatus: ServiceStatus | null
  totalPaid: number
  /** Whether the recipient edit pencil is interactive (canEdit && !voided). */
  canEdit: boolean
  /** Receives the imperative print-dialog opener so the actions bar can trigger it. */
  onPrintReady?: (open: (mode: PrintMode) => void) => void
}

export function InvoiceDocument({
  invoice,
  items,
  products,
  serviceStatuses,
  currentServiceStatus,
  totalPaid,
  canEdit,
  onPrintReady,
}: InvoiceDocumentProps) {
  const router = useRouter()
  const { show } = useToast()
  const printRef = useRef<HTMLDivElement>(null)

  // Print state (no persistence — overrides apply to the printout only).
  const [printMode, setPrintMode] = useState<PrintMode>('invoice')
  const [printNonce, setPrintNonce] = useState(0)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<PrintMode>('invoice')
  const [printDraft, setPrintDraft] = useState<PrintOverrides | null>(null)
  const [printOverrides, setPrintOverrides] = useState<PrintOverrides | null>(null)

  // Recipient editor state.
  const [recipientOpen, setRecipientOpen] = useState(false)
  const [editBillToName, setEditBillToName] = useState('')
  const [editBillToContact, setEditBillToContact] = useState('')
  const [editBillToPhone, setEditBillToPhone] = useState('')
  const [editBilling, setEditBilling] = useState('')
  const [editShipToName, setEditShipToName] = useState('')
  const [editShipToContact, setEditShipToContact] = useState('')
  const [editDelivery, setEditDelivery] = useState('')
  const [alsoSaveToCustomer, setAlsoSaveToCustomer] = useState(false)
  const [savingRecipient, setSavingRecipient] = useState(false)

  const openPrintDialog = (mode: PrintMode) => {
    setDialogMode(mode)
    setPrintDraft({
      date: invoice.invoice_date,
      dueDate: invoice.due_date ?? '',
      billToName: invoice.bill_to_name ?? '',
      billToContact: invoice.bill_to_contact ?? '',
      billToPhone: invoice.bill_to_phone ?? '',
      billingAddress: invoice.billing_address ?? '',
      shipToName: invoice.ship_to_name ?? '',
      shipToContact: invoice.ship_to_contact ?? '',
      deliveryAddress: invoice.delivery_address ?? '',
      patient: invoice.patient ?? '',
      doctor: invoice.doctor ?? '',
      serviceStatusId: invoice.service_status_id,
      instructions: '',
      itemOverrides: Object.fromEntries(items.map(it => [it.id, {
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
      }])),
    })
    setPrintDialogOpen(true)
  }

  // Hand the actions bar a stable opener so its Print buttons drive this dialog.
  useEffect(() => {
    onPrintReady?.(openPrintDialog)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConfirmPrint = () => {
    if (!printDraft) return
    setPrintOverrides(printDraft)
    setPrintMode(dialogMode)
    setPrintDialogOpen(false)
    setPrintNonce(n => n + 1)
  }

  useEffect(() => {
    if (printNonce === 0) return
    const onAfter = () => {
      setPrintMode('invoice')
      setPrintOverrides(null)
    }
    window.addEventListener('afterprint', onAfter, { once: true })
    window.print()
    return () => window.removeEventListener('afterprint', onAfter)
  }, [printNonce])

  const openRecipientDialog = () => {
    setEditBillToName(invoice.bill_to_name ?? '')
    setEditBillToContact(invoice.bill_to_contact ?? '')
    setEditBillToPhone(invoice.bill_to_phone ?? '')
    setEditBilling(invoice.billing_address ?? '')
    setEditShipToName(invoice.ship_to_name ?? '')
    setEditShipToContact(invoice.ship_to_contact ?? '')
    setEditDelivery(invoice.delivery_address ?? '')
    setAlsoSaveToCustomer(false)
    setRecipientOpen(true)
  }

  const saveRecipient = async () => {
    setSavingRecipient(true)
    const fields = {
      bill_to_name: editBillToName.trim() || null,
      bill_to_contact: editBillToContact.trim() || null,
      bill_to_phone: editBillToPhone.trim() || null,
      billing_address: editBilling.trim() || null,
      ship_to_name: editShipToName.trim() || null,
      ship_to_contact: editShipToContact.trim() || null,
      delivery_address: editDelivery.trim() || null,
    }
    const res = await saveRecipientAction(invoice.id, fields, {
      alsoSaveToCustomer: alsoSaveToCustomer && !!invoice.customer_id,
      customerId: invoice.customer_id ?? undefined,
    })
    setSavingRecipient(false)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    setRecipientOpen(false)
    show({ variant: 'success', title: 'Recipient updated' })
    router.refresh()
  }

  const resolveFields = (overrides: PrintOverrides | null) => {
    const o = overrides
    const itemResolve = (it: InvoiceItem) => {
      const ov = o?.itemOverrides[it.id]
      const description = ov?.description ?? it.description
      const quantity = ov ? ov.quantity : Number(it.quantity)
      const unitPrice = ov ? ov.unitPrice : Number(it.unit_price)
      return { description, quantity, unitPrice, amount: quantity * unitPrice }
    }
    const previewTotal = o
      ? items.reduce((sum, it) => sum + itemResolve(it).amount, 0)
      : Number(invoice.total)
    return {
      field: {
        date:            o ? o.date            : invoice.invoice_date,
        dueDate:         o ? o.dueDate         : invoice.due_date,
        billToName:      o ? o.billToName      : invoice.bill_to_name,
        billToContact:   o ? o.billToContact   : invoice.bill_to_contact,
        billToPhone:     o ? o.billToPhone     : invoice.bill_to_phone,
        billingAddress:  o ? o.billingAddress  : invoice.billing_address,
        shipToName:      o ? o.shipToName      : invoice.ship_to_name,
        shipToContact:   o ? o.shipToContact   : invoice.ship_to_contact,
        deliveryAddress: o ? o.deliveryAddress : invoice.delivery_address,
        patient:         o ? o.patient         : invoice.patient,
        doctor:          o ? o.doctor          : invoice.doctor,
      },
      serviceStatusForPrint: o
        ? (serviceStatuses.find(s => s.id === o.serviceStatusId) ?? null)
        : currentServiceStatus,
      itemResolve,
      previewTotal,
      instructions: o?.instructions ?? '',
    }
  }

  const renderDocBody = (opts: {
    mode: PrintMode
    resolved: ReturnType<typeof resolveFields>
    showInlineEdit: boolean
  }) => {
    const { mode, resolved, showInlineEdit } = opts
    const { field, serviceStatusForPrint, itemResolve, previewTotal, instructions } = resolved
    const isDelivery = mode === 'delivery'
    return (
      <>
        {isVoided(invoice) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-lg overflow-hidden">
            <span className="text-red-200 text-[120px] font-black uppercase tracking-widest rotate-[-30deg] select-none opacity-60">
              VOID
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            {/* Plain <img>: this is a printable invoice document header, where
                next/image's lazy-loading and srcset rewriting render unreliably. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt={COMPANY.name} className="max-h-10 max-w-[200px] object-contain object-left mb-2" />
            <div className="text-sm text-gray-500 whitespace-pre-line">{COMPANY.address}</div>
            {COMPANY.phone && <div className="text-sm text-gray-500">Tel: {COMPANY.phone}</div>}
            {COMPANY.email && <div className="text-sm text-gray-500">{COMPANY.email}</div>}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-200 uppercase tracking-widest mb-2">
              {isDelivery ? 'Delivery Note' : 'Invoice'}
            </div>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-gray-400">{isDelivery ? 'Order #: ' : 'Invoice #: '}</span>
                <span className="font-semibold">{invoice.invoice_number}</span>
              </div>
              <div><span className="text-gray-400">Date: </span>{formatDate(field.date)}</div>
              {!isDelivery && field.dueDate && (
                <div><span className="text-gray-400">Due: </span>{formatDate(field.dueDate)}</div>
              )}
            </div>
          </div>
        </div>

        {/* Bill To / Deliver To + Case Details */}
        <div className="mb-8 flex flex-wrap gap-6 justify-between">
          <div className={`grid gap-6 flex-1 ${field.deliveryAddress ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Bill To</div>
                {showInlineEdit && canEdit && (
                  <button
                    type="button"
                    onClick={openRecipientDialog}
                    className="print:hidden text-gray-400 hover:text-primary"
                    aria-label="Edit recipient"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {field.billToName && <div className="font-semibold text-gray-900">{field.billToName}</div>}
              {field.billToContact && <div className="text-sm text-gray-600">{field.billToContact}</div>}
              {field.billingAddress && <div className="text-sm text-gray-500 whitespace-pre-line">{field.billingAddress}</div>}
              {field.billToPhone && <div className="text-sm text-gray-500">Tel: {field.billToPhone}</div>}
            </div>
            {field.deliveryAddress && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Deliver To</div>
                {field.shipToName && <div className="font-semibold text-gray-900">{field.shipToName}</div>}
                {field.shipToContact && <div className="text-sm text-gray-600">{field.shipToContact}</div>}
                <div className="text-sm text-gray-500 whitespace-pre-line">{field.deliveryAddress}</div>
              </div>
            )}
          </div>
          {(field.patient || field.doctor || serviceStatusForPrint) && (
            <div className="min-w-[160px] text-right">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Case Details</div>
              {field.patient && (
                <div className="text-sm">
                  <span className="text-gray-400">Patient: </span>
                  <span className="font-medium text-gray-900">{field.patient}</span>
                </div>
              )}
              {field.doctor && (
                <div className="text-sm">
                  <span className="text-gray-400">Doctor: </span>
                  <span className="font-medium text-gray-900">{field.doctor}</span>
                </div>
              )}
              {serviceStatusForPrint && (
                <div className="text-sm mt-1">
                  <span className="text-gray-400">Service Status: </span>
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', serviceStatusForPrint.color ?? DEFAULT_COLOR)}>
                    {serviceStatusForPrint.label}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Line items */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 text-gray-500 font-medium w-1/2">Item</th>
              <th className="text-right py-2 text-gray-500 font-medium">Qty</th>
              {!isDelivery && (
                <>
                  <th className="text-right py-2 text-gray-500 font-medium">Unit Price</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Amount</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const r = itemResolve(item)
              const productDescription = item.product_id
                ? products.find(p => p.id === item.product_id)?.description
                : null
              return (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-2.5">
                    <div>{r.description}</div>
                    {productDescription && (
                      <div className="text-xs text-gray-400 mt-0.5">{productDescription}</div>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-gray-600">{r.quantity}</td>
                  {!isDelivery && (
                    <>
                      <td className="py-2.5 text-right text-gray-600">{formatCurrency(r.unitPrice)}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(r.amount)}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
          {!isDelivery && (
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-4 text-right font-semibold text-gray-700">Total</td>
                <td className="pt-4 text-right text-lg font-bold text-gray-900">{formatCurrency(previewTotal)}</td>
              </tr>
              {totalPaid > 0 && (
                <>
                  <tr>
                    <td colSpan={3} className="pt-1 text-right text-gray-500">Amount Paid</td>
                    <td className="pt-1 text-right text-green-600">({formatCurrency(totalPaid)})</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pt-1 text-right font-semibold text-gray-700">Balance Due</td>
                    <td className="pt-1 text-right font-bold text-red-600">{formatCurrency(invoice.status === 'paid' ? 0 : previewTotal - totalPaid)}</td>
                  </tr>
                </>
              )}
            </tfoot>
          )}
        </table>

        {!isDelivery && (
          <>
            <Separator className="mb-6" />
            <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Payment Details</div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div><span className="text-gray-500">Bank: </span><span className="font-medium">{BANK.bankName}</span></div>
                <div><span className="text-gray-500">Account Name: </span><span className="font-medium">{BANK.accountName}</span></div>
                <div><span className="text-gray-500">Account No: </span><span className="font-medium font-mono">{BANK.accountNumber}</span></div>
              </div>
              <p className="text-xs text-primary/60 mt-3 italic">{BANK.paymentNote}</p>
            </div>
          </>
        )}

        {isDelivery && instructions && (
          <div className="mt-6 p-3 bg-gray-50 rounded text-sm text-gray-700">
            <span className="font-medium">Delivery instructions: </span>{instructions}
          </div>
        )}

        {isDelivery && (
          <div className="mt-16 flex justify-end text-sm">
            <div className="w-64">
              <div className="text-gray-700 mb-1">Agreed &amp; Confirm by</div>
              <div className="border-b border-gray-400 h-20" />
              <div className="mt-2 text-xs text-gray-500">Signature / Stamp</div>
            </div>
          </div>
        )}
      </>
    )
  }

  const printResolved = resolveFields(printOverrides)
  const draftResolved = printDraft ? resolveFields(printDraft) : null

  return (
    <>
      {/* Invoice document — also used for printing */}
      <div ref={printRef} className="relative bg-white border rounded-lg p-8 print:border-0 print:p-6 print:shadow-none" id="invoice-print">
        {renderDocBody({ mode: printMode, resolved: printResolved, showInlineEdit: true })}
      </div>

      {/* Unified print dialog — preview on left, editor on right */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-w-[1400px] w-[96vw] max-h-[94vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-3">
              <Printer className="h-5 w-5 text-primary" />
              {dialogMode === 'delivery' ? 'Print Delivery Note' : 'Print Invoice'}
            </DialogTitle>
            <p className="text-xs text-gray-500 mt-1">
              Preview on the left — adjust anything on the right, then print.
            </p>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] flex-1 overflow-hidden">
            {/* Live preview (LEFT) */}
            <div className="overflow-auto bg-gray-100 px-6 py-4 border-r">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Preview</div>
              <div className="bg-white shadow-md mx-auto" style={{ width: '760px' }}>
                <div className="relative p-8">
                  {draftResolved && renderDocBody({ mode: dialogMode, resolved: draftResolved, showInlineEdit: false })}
                </div>
              </div>
            </div>

            {/* Edit form (RIGHT) */}
            <div className="overflow-y-auto px-6 py-4 bg-white">
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 mb-4">
                These edits apply only to this printout. <strong>Nothing is saved</strong> to the invoice.
              </div>

              {printDraft && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Date</Label>
                      <Input
                        type="date"
                        value={printDraft.date}
                        onChange={e => setPrintDraft(d => d && ({ ...d, date: e.target.value }))}
                      />
                    </div>
                    {dialogMode === 'invoice' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Due date</Label>
                        <Input
                          type="date"
                          value={printDraft.dueDate}
                          onChange={e => setPrintDraft(d => d && ({ ...d, dueDate: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>

                  <fieldset className="border rounded-md p-3 space-y-2.5">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Bill To</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Name</Label>
                      <Input value={printDraft.billToName} onChange={e => setPrintDraft(d => d && ({ ...d, billToName: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Contact</Label>
                        <Input value={printDraft.billToContact} onChange={e => setPrintDraft(d => d && ({ ...d, billToContact: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Phone</Label>
                        <Input value={printDraft.billToPhone} onChange={e => setPrintDraft(d => d && ({ ...d, billToPhone: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Address</Label>
                      <Textarea rows={2} value={printDraft.billingAddress} onChange={e => setPrintDraft(d => d && ({ ...d, billingAddress: e.target.value }))} />
                    </div>
                  </fieldset>

                  <fieldset className="border rounded-md p-3 space-y-2.5">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Deliver To</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Name</Label>
                        <Input value={printDraft.shipToName} onChange={e => setPrintDraft(d => d && ({ ...d, shipToName: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Contact</Label>
                        <Input value={printDraft.shipToContact} onChange={e => setPrintDraft(d => d && ({ ...d, shipToContact: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Address <span className="text-gray-400 font-normal">(leave empty to hide)</span></Label>
                      <Textarea rows={2} value={printDraft.deliveryAddress} onChange={e => setPrintDraft(d => d && ({ ...d, deliveryAddress: e.target.value }))} />
                    </div>
                  </fieldset>

                  <fieldset className="border rounded-md p-3 space-y-2.5">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Case</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Patient</Label>
                        <Input value={printDraft.patient} onChange={e => setPrintDraft(d => d && ({ ...d, patient: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Doctor</Label>
                        <Input value={printDraft.doctor} onChange={e => setPrintDraft(d => d && ({ ...d, doctor: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Service Status</Label>
                      <Select
                        value={printDraft.serviceStatusId ?? '__none__'}
                        onValueChange={v => setPrintDraft(d => d && ({ ...d, serviceStatusId: v === '__none__' ? null : v }))}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="No status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No status</SelectItem>
                          {serviceStatuses.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </fieldset>

                  {items.length > 0 && (
                    <fieldset className="border rounded-md p-3 space-y-2">
                      <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Line items</legend>
                      <div className={cn(
                        'grid items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 px-0.5',
                        dialogMode === 'invoice'
                          ? 'grid-cols-[minmax(0,1fr)_60px_90px]'
                          : 'grid-cols-[minmax(0,1fr)_60px]',
                      )}>
                        <div>Description</div>
                        <div className="text-right">Qty</div>
                        {dialogMode === 'invoice' && <div className="text-right">Unit price</div>}
                      </div>
                      <div className="space-y-1.5">
                        {items.map(it => {
                          const ov = printDraft.itemOverrides[it.id]
                          const updateItem = (next: Partial<ItemOverride>) =>
                            setPrintDraft(d => d && ({
                              ...d,
                              itemOverrides: { ...d.itemOverrides, [it.id]: { ...d.itemOverrides[it.id], ...next } },
                            }))
                          return (
                            <div key={it.id} className={cn(
                              'grid items-center gap-2',
                              dialogMode === 'invoice'
                                ? 'grid-cols-[minmax(0,1fr)_60px_90px]'
                                : 'grid-cols-[minmax(0,1fr)_60px]',
                            )}>
                              <Input
                                className="h-8 text-sm"
                                value={ov?.description ?? ''}
                                onChange={e => updateItem({ description: e.target.value })}
                              />
                              <Input
                                className="h-8 text-sm text-right tabular-nums"
                                type="number"
                                step="1"
                                min="1"
                                value={ov?.quantity ?? 1}
                                onChange={e => updateItem({ quantity: Math.max(1, Math.floor(parseFloat(e.target.value) || 1)) })}
                              />
                              {dialogMode === 'invoice' && (
                                <Input
                                  className="h-8 text-sm text-right tabular-nums"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={ov?.unitPrice ?? 0}
                                  onChange={e => updateItem({ unitPrice: Number(e.target.value) || 0 })}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {dialogMode === 'invoice' && draftResolved && (
                        <div className="flex justify-between items-center pt-2 border-t text-sm">
                          <span className="text-gray-500">Total</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(draftResolved.previewTotal)}</span>
                        </div>
                      )}
                    </fieldset>
                  )}

                  {dialogMode === 'delivery' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">
                        Delivery instructions <span className="text-gray-400 font-normal">(prints only on the delivery note)</span>
                      </Label>
                      <Textarea
                        rows={2}
                        placeholder="e.g. Leave at reception"
                        value={printDraft.instructions}
                        onChange={e => setPrintDraft(d => d && ({ ...d, instructions: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-white">
            <Button variant="outline" onClick={() => setPrintDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmPrint}>
              <Printer className="h-4 w-4 mr-2" />Print {dialogMode === 'delivery' ? 'Delivery Note' : 'Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit recipient dialog */}
      <Dialog open={recipientOpen} onOpenChange={setRecipientOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit recipient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bill To</div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={editBillToName} onChange={e => setEditBillToName(e.target.value)} placeholder="Recipient name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Contact person</Label>
                  <Input value={editBillToContact} onChange={e => setEditBillToContact(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input value={editBillToPhone} onChange={e => setEditBillToPhone(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Textarea value={editBilling} onChange={e => setEditBilling(e.target.value)} rows={3} placeholder="Billing address" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Deliver To</div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={editShipToName} onChange={e => setEditShipToName(e.target.value)} placeholder="Recipient name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Contact person</Label>
                  <Input value={editShipToContact} onChange={e => setEditShipToContact(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Textarea value={editDelivery} onChange={e => setEditDelivery(e.target.value)} rows={6} placeholder="Leave empty to hide Deliver To block" />
                </div>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={alsoSaveToCustomer}
                onChange={e => setAlsoSaveToCustomer(e.target.checked)}
              />
              <span>
                Also save to customer record
                <span className="block text-xs text-gray-500">
                  Updates the master customer with the Bill To values, plus both addresses. Future invoices use these defaults.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipientOpen(false)} disabled={savingRecipient}>Cancel</Button>
            <Button onClick={saveRecipient} disabled={savingRecipient}>{savingRecipient ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
