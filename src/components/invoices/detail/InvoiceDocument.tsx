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
import { PhoneInput } from '@/components/ui/phone-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ServiceStatusSelectItem } from '@/components/invoices/ServiceStatusSelectItem'
import { ManageOptionsLink } from '@/components/ui/manage-options-link'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Printer, Pencil, Plus, Trash2 } from 'lucide-react'
import { isVoided } from '@/lib/invoice-status'
import { saveRecipientAction } from '@/data/invoice-actions'
import type { InvoiceItem, Product, ServiceStatus, WorkStage, WorkStatusConfig } from '@/lib/database.types'
import type { InvoiceDetail } from '@/data/invoices'
import { COMPANY, type BillingSettings } from '@/lib/config'
import { paymentDetailsForInvoice } from '@/lib/billing-settings'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { workLabel, workColor } from '@/lib/work-stages'

// 'invoice' / 'delivery' go through the print-preview override dialog; the bench
// 'work_ticket' is internal and prints directly (no overrides — see openPrintDialog).
type PrintMode = 'invoice' | 'delivery' | 'work_ticket'

// A single print line item. For an existing invoice item `id` is the DB row id
// and `productId` lets the preview keep showing the product sub-description.
// Lines added in the dialog get a synthetic `id` ('new-N') and no productId.
// Editing these is print-only — nothing is saved back to the invoice.
type PrintLineItem = {
  id: string
  description: string
  quantity: number
  unitPrice: number
  productId: string | null
}

type PrintOverrides = {
  date: string
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
  lineItems: PrintLineItem[]
}

export type InvoiceDocumentProps = {
  invoice: InvoiceDetail
  items: InvoiceItem[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
  currentServiceStatus: ServiceStatus | null
  /** Work stages — used to label per-item production status on the work ticket. */
  stages: WorkStage[]
  workStatusConfigs: WorkStatusConfig[]
  totalPaid: number
  billingSettings: BillingSettings
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
  stages,
  workStatusConfigs,
  totalPaid,
  billingSettings,
  canEdit,
  onPrintReady,
}: InvoiceDocumentProps) {
  const router = useRouter()
  const { show } = useToast()
  const printRef = useRef<HTMLDivElement>(null)
  // Monotonic counter for synthetic ids of line items added in the print dialog.
  const newLineId = useRef(0)
  // Labels per-item work status on the work ticket (handles in-progress stages).
  const stagesById = new Map(stages.map(s => [s.id, s]))
  const paymentDetails = paymentDetailsForInvoice(invoice, billingSettings)

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
    // The bench work ticket has no money/recipient fields to override, so it
    // skips the preview-and-edit dialog and prints the case as-is. The override
    // editor only makes sense for the customer-facing invoice / delivery order.
    if (mode === 'work_ticket') {
      setPrintOverrides(null)
      setPrintMode('work_ticket')
      setPrintNonce(n => n + 1)
      return
    }
    setDialogMode(mode)
    setPrintDraft({
      date: invoice.invoice_date,
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
      lineItems: items.map(it => ({
        id: it.id,
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
        productId: it.product_id ?? null,
      })),
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

  // The product sub-description shown under a line in the printout.
  const productDescriptionFor = (productId: string | null) =>
    productId ? products.find(p => p.id === productId)?.description ?? null : null

  const resolveFields = (overrides: PrintOverrides | null) => {
    const o = overrides
    // Normalized lines to render. With overrides we render the dialog's editable
    // list (supports added/removed lines); otherwise the saved invoice items.
    const lines = o
      ? o.lineItems.map(li => ({
          id: li.id,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          amount: li.quantity * li.unitPrice,
          productDescription: productDescriptionFor(li.productId),
        }))
      : items.map(it => ({
          id: it.id,
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unit_price),
          amount: Number(it.quantity) * Number(it.unit_price),
          productDescription: productDescriptionFor(it.product_id ?? null),
        }))
    // Total = sum of (possibly overridden) line amounts; with no overrides we use
    // the stored invoice total verbatim. Discount and SST tax have been removed
    // from the product, so there is no Subtotal/Discount/Tax breakdown.
    const previewTotal = o
      ? lines.reduce((sum, l) => sum + l.amount, 0)
      : Number(invoice.total)
    return {
      field: {
        date:            o ? o.date            : invoice.invoice_date,
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
      lines,
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
    const { field, serviceStatusForPrint, lines, previewTotal, instructions } = resolved
    const isDelivery = mode === 'delivery'
    // Deliver To is captured on every invoice (seeded from the clinic). We always
    // print it as its own column when any ship-to detail exists — even when it is
    // identical to Bill To, it simply duplicates. (Legacy invoices with no stored
    // ship-to collapse to a single full-width Bill To block.)
    const norm = (v: string | null | undefined) => (v ?? '').trim()
    const showDeliverTo = Boolean(norm(field.shipToName) || norm(field.shipToContact) || norm(field.deliveryAddress))
    // Payment terms = the lab's standard term (days), from billing settings. The
    // invoice no longer captures or prints a specific due date; only this terms
    // line remains. (Terms aren't snapshotted per invoice — see paymentDetails.)
    const paymentTermsDays = paymentDetails.paymentTermsDays
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
            <img src="/chidental-rectangle.png" alt={COMPANY.name} className="max-h-12 max-w-[220px] object-contain object-left mb-2" />
            <div className="text-sm text-gray-500 whitespace-pre-line">{COMPANY.address}</div>
            {COMPANY.phone && <div className="text-sm text-gray-500">Tel: {COMPANY.phone}</div>}
            {COMPANY.email && <div className="text-sm text-gray-500">{COMPANY.email}</div>}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-200 uppercase tracking-widest mb-2">
              {isDelivery ? 'Delivery Order' : 'Invoice'}
            </div>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-gray-400">{isDelivery ? 'D/O #: ' : 'Invoice #: '}</span>
                <span className="font-semibold">{isDelivery ? invoice.delivery_order_number : invoice.invoice_number}</span>
              </div>
              <div><span className="text-gray-400">Date: </span>{formatDate(field.date)}</div>
            </div>
          </div>
        </div>

        {/* Bill To / Deliver To + Case Details */}
        <div className="mb-8 flex flex-wrap gap-6 justify-between">
          <div className={`grid gap-6 flex-1 ${showDeliverTo ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
            {showDeliverTo && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Deliver To</div>
                {field.shipToName && <div className="font-semibold text-gray-900">{field.shipToName}</div>}
                {field.shipToContact && <div className="text-sm text-gray-600">{field.shipToContact}</div>}
                <div className="text-sm text-gray-500 whitespace-pre-line">{field.deliveryAddress || field.billingAddress}</div>
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
            {lines.map(line => (
              <tr key={line.id} className="border-b border-gray-100">
                <td className="py-2.5">
                  <div>{line.description}</div>
                  {line.productDescription && (
                    <div className="text-xs text-gray-400 mt-0.5">{line.productDescription}</div>
                  )}
                </td>
                <td className="py-2.5 text-right text-gray-600">{line.quantity}</td>
                {!isDelivery && (
                  <>
                    <td className="py-2.5 text-right text-gray-600">{formatCurrency(line.unitPrice)}</td>
                    <td className="py-2.5 text-right font-medium">{formatCurrency(line.amount)}</td>
                  </>
                )}
              </tr>
            ))}
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
              <div className="grid grid-cols-2 gap-x-8">
                {/* Left: bank / payment details */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Payment Details</div>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-gray-500">Bank: </span><span className="font-medium">{paymentDetails.bankName}</span></div>
                    <div><span className="text-gray-500">Account Name: </span><span className="font-medium">{paymentDetails.accountName}</span></div>
                    <div><span className="text-gray-500">Account No: </span><span className="font-medium font-mono">{paymentDetails.accountNumber}</span></div>
                  </div>
                  {paymentDetails.paymentNote && (
                    <p className="text-xs text-primary/60 mt-3 italic">{paymentDetails.paymentNote}</p>
                  )}
                </div>
                {/* Right: payment terms + standing notes */}
                <div className="text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Payment Terms</div>
                  <div className="font-medium text-gray-700 mb-3">{paymentTermsDays} Days</div>
                  {paymentDetails.invoiceNotes.length > 0 && (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Note</div>
                      <ol className="list-decimal list-inside text-gray-700 space-y-0.5">
                        {paymentDetails.invoiceNotes.map((note, i) => <li key={i}>{note}</li>)}
                      </ol>
                    </>
                  )}
                </div>
              </div>
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
              <div className="text-gray-700">Received above goods in Good Order and Condition.</div>
              <div className="mt-6 text-gray-700">Received By:</div>
              <div className="mt-12 border-b border-gray-400" />
              <div className="mt-2 text-xs text-gray-500">Name, Signature, Date &amp; Company Stamp</div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Internal bench work ticket — NO prices, totals, payment status or bank
  // details. Reuses the same document chrome/branding/print CSS as the invoice
  // so it prints cleanly, but shows what the bench needs: case ref + dates,
  // clinic / patient / doctor, service status, and per-item work status + the
  // internal work_note (the bench instructions). Always renders saved data —
  // the work ticket has no override editor (see openPrintDialog).
  const renderWorkTicketBody = () => {
    const clinicName = invoice.bill_to_name ?? invoice.customers?.clinic_name ?? null
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
            {/* Plain <img>: see renderDocBody for why next/image isn't used here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/chidental-rectangle.png" alt={COMPANY.name} className="max-h-12 max-w-[220px] object-contain object-left mb-2" />
            <div className="text-sm text-gray-500 whitespace-pre-line">{COMPANY.address}</div>
            {COMPANY.phone && <div className="text-sm text-gray-500">Tel: {COMPANY.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-200 uppercase tracking-widest mb-2">Work Ticket</div>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-gray-400">Case #: </span>
                <span className="font-semibold">{invoice.invoice_number}</span>
              </div>
              <div><span className="text-gray-400">Date: </span>{formatDate(invoice.invoice_date)}</div>
            </div>
          </div>
        </div>

        {/* Clinic + Case details — no addresses, no money */}
        <div className="mb-8 flex flex-wrap gap-6 justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Clinic</div>
            {clinicName && <div className="font-semibold text-gray-900">{clinicName}</div>}
          </div>
          {(invoice.patient || invoice.doctor || currentServiceStatus) && (
            <div className="min-w-[160px] text-right">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Case Details</div>
              {invoice.patient && (
                <div className="text-sm">
                  <span className="text-gray-400">Patient: </span>
                  <span className="font-medium text-gray-900">{invoice.patient}</span>
                </div>
              )}
              {invoice.doctor && (
                <div className="text-sm">
                  <span className="text-gray-400">Doctor: </span>
                  <span className="font-medium text-gray-900">{invoice.doctor}</span>
                </div>
              )}
              {currentServiceStatus && (
                <div className="text-sm mt-1">
                  <span className="text-gray-400">Service Status: </span>
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', currentServiceStatus.color ?? DEFAULT_COLOR)}>
                    {currentServiceStatus.label}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Line items — description, qty, work status, work note. No prices. */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 text-gray-500 font-medium w-1/2">Item</th>
              <th className="text-right py-2 text-gray-500 font-medium">Qty</th>
              <th className="text-left py-2 text-gray-500 font-medium pl-4">Work Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const productDescription = item.product_id
                ? products.find(p => p.id === item.product_id)?.description
                : null
              return (
                <tr key={item.id} className="border-b border-gray-100 align-top">
                  <td className="py-2.5">
                    <div>{item.description}</div>
                    {productDescription && (
                      <div className="text-xs text-gray-400 mt-0.5">{productDescription}</div>
                    )}
                    {item.work_note && (
                      <div className="text-xs text-gray-600 mt-1">
                        <span className="text-gray-400">Note: </span>{item.work_note}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-gray-600">{Number(item.quantity)}</td>
                  <td className="py-2.5 pl-4">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', workColor(item.work_status, item.stage_id, stagesById, workStatusConfigs))}>
                      {workLabel(item.work_status, item.stage_id, stagesById, workStatusConfigs)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Checked-by / signature — bench sign-off */}
        <div className="mt-16 flex justify-end text-sm">
          <div className="w-64">
            <div className="text-gray-700 mb-1">Checked by</div>
            <div className="border-b border-gray-400 h-20" />
            <div className="mt-2 text-xs text-gray-500">Name / Signature / Date</div>
          </div>
        </div>
      </>
    )
  }

  const printResolved = resolveFields(printOverrides)
  const draftResolved = printDraft ? resolveFields(printDraft) : null

  return (
    <>
      {/* Invoice document — also used for printing */}
      <div ref={printRef} className="relative bg-white border rounded-lg p-8 print:border-0 print:p-6 print:shadow-none" id="invoice-print">
        {printMode === 'work_ticket'
          ? renderWorkTicketBody()
          : renderDocBody({ mode: printMode, resolved: printResolved, showInlineEdit: true })}
      </div>

      {/* Unified print dialog — preview on left, editor on right */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-h-[94dvh] w-[96vw] max-w-[1400px] gap-0 overflow-hidden p-0 flex flex-col">
          <DialogHeader className="border-b px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
            <DialogTitle className="flex items-center gap-3">
              <Printer className="h-5 w-5 text-primary" />
              {dialogMode === 'delivery' ? 'Print Delivery Order' : 'Print Invoice'}
            </DialogTitle>
            <p className="text-xs text-gray-500 mt-1">
              Preview on the left — adjust anything on the right, then print.
            </p>
          </DialogHeader>

          <div className="grid flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:overflow-hidden">
            {/* Live preview (LEFT) */}
            <div className="max-h-[42vh] overflow-auto border-r bg-gray-100 px-4 py-4 sm:px-6 lg:max-h-none">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Preview</div>
              <div className="bg-white shadow-md mx-auto" style={{ width: '760px' }}>
                <div className="relative p-8">
                  {draftResolved && renderDocBody({ mode: dialogMode, resolved: draftResolved, showInlineEdit: false })}
                </div>
              </div>
            </div>

            {/* Edit form (RIGHT) */}
            <div className="overflow-y-auto bg-white px-4 py-4 sm:px-6">
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 mb-4">
                These edits apply only to this printout. <strong>Nothing is saved</strong> to the invoice.
              </div>

              {printDraft && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500">Date</Label>
                    <Input
                      type="date"
                      value={printDraft.date}
                      onChange={e => setPrintDraft(d => d && ({ ...d, date: e.target.value }))}
                    />
                  </div>

                  <fieldset className="border rounded-md p-3 space-y-2.5">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Bill To</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Clinic</Label>
                      <Input value={printDraft.billToName} onChange={e => setPrintDraft(d => d && ({ ...d, billToName: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Contact person</Label>
                        <Input value={printDraft.billToContact} onChange={e => setPrintDraft(d => d && ({ ...d, billToContact: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Phone</Label>
                        <PhoneInput
                          value={printDraft.billToPhone}
                          onChange={value => setPrintDraft(d => d && ({ ...d, billToPhone: value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">Address</Label>
                      <Textarea rows={2} value={printDraft.billingAddress} onChange={e => setPrintDraft(d => d && ({ ...d, billingAddress: e.target.value }))} />
                    </div>
                  </fieldset>

                  <fieldset className="border rounded-md p-3 space-y-2.5">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Deliver To</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Clinic</Label>
                        <Input value={printDraft.shipToName} onChange={e => setPrintDraft(d => d && ({ ...d, shipToName: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Contact person</Label>
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                            <ServiceStatusSelectItem key={s.id} status={s} />
                          ))}
                          <ManageOptionsLink href="/settings/service-statuses" label="Manage service statuses" />
                        </SelectContent>
                      </Select>
                    </div>
                  </fieldset>

                  <fieldset className="border rounded-md p-3 space-y-2">
                    <legend className="text-xs font-semibold text-gray-500 px-1 uppercase tracking-wider">Line items</legend>
                    {printDraft.lineItems.length > 0 && (
                      <div className={cn(
                        'hidden items-center gap-2 px-0.5 text-[10px] uppercase tracking-wider text-gray-400 sm:grid',
                        dialogMode === 'invoice'
                          ? 'grid-cols-[minmax(0,1fr)_60px_90px_32px]'
                          : 'grid-cols-[minmax(0,1fr)_60px_32px]',
                      )}>
                        <div>Item name</div>
                        <div className="text-right">Qty</div>
                        {dialogMode === 'invoice' && <div className="text-right">Unit price</div>}
                        <div />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {printDraft.lineItems.map((li, idx) => {
                        const updateLine = (next: Partial<PrintLineItem>) =>
                          setPrintDraft(d => d && ({
                            ...d,
                            lineItems: d.lineItems.map((l, i) => i === idx ? { ...l, ...next } : l),
                          }))
                        const removeLine = () =>
                          setPrintDraft(d => d && ({
                            ...d,
                            lineItems: d.lineItems.filter((_, i) => i !== idx),
                          }))
                        return (
                          <div key={li.id} className={cn(
                            'grid grid-cols-1 gap-2 sm:items-center',
                            dialogMode === 'invoice'
                              ? 'sm:grid-cols-[minmax(0,1fr)_60px_90px_32px]'
                              : 'sm:grid-cols-[minmax(0,1fr)_60px_32px]',
                          )}>
                            <Input
                              className="h-8 text-sm"
                              placeholder="Item name"
                              value={li.description}
                              onChange={e => updateLine({ description: e.target.value })}
                            />
                            <Input
                              className="h-8 text-sm text-right tabular-nums"
                              type="number"
                              step="1"
                              min="1"
                              value={li.quantity}
                              onChange={e => updateLine({ quantity: Math.max(1, Math.floor(parseFloat(e.target.value) || 1)) })}
                            />
                            {dialogMode === 'invoice' && (
                              <Input
                                className="h-8 text-sm text-right tabular-nums"
                                type="number"
                                step="0.01"
                                min="0"
                                value={li.unitPrice}
                                onChange={e => updateLine({ unitPrice: Number(e.target.value) || 0 })}
                              />
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-red-600"
                              onClick={removeLine}
                              aria-label="Remove line item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )
                      })}
                      {printDraft.lineItems.length === 0 && (
                        <p className="text-xs text-gray-400 py-1">No line items. Add one below.</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full"
                      onClick={() =>
                        setPrintDraft(d => d && ({
                          ...d,
                          lineItems: [...d.lineItems, {
                            id: `new-${newLineId.current++}`,
                            description: '',
                            quantity: 1,
                            unitPrice: 0,
                            productId: null,
                          }],
                        }))
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" />Add line item
                    </Button>
                    {dialogMode === 'invoice' && draftResolved && (
                      <div className="flex justify-between items-center pt-2 border-t text-sm">
                        <span className="text-gray-500">Total</span>
                        <span className="font-semibold tabular-nums">{formatCurrency(draftResolved.previewTotal)}</span>
                      </div>
                    )}
                  </fieldset>

                  {dialogMode === 'delivery' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-500">
                        Delivery instructions <span className="text-gray-400 font-normal">(prints only on the delivery order)</span>
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

          <DialogFooter className="border-t bg-white px-4 py-4 sm:px-6">
            <Button variant="outline" onClick={() => setPrintDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmPrint}>
              <Printer className="h-4 w-4 mr-2" />Print {dialogMode === 'delivery' ? 'Delivery Order' : 'Invoice'}
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
                  <Label className="text-xs">Clinic</Label>
                  <Input value={editBillToName} onChange={e => setEditBillToName(e.target.value)} placeholder="Clinic name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Contact person</Label>
                  <Input value={editBillToContact} onChange={e => setEditBillToContact(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <PhoneInput value={editBillToPhone} onChange={setEditBillToPhone} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Textarea value={editBilling} onChange={e => setEditBilling(e.target.value)} rows={3} placeholder="Billing address" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Deliver To</div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Clinic</Label>
                  <Input value={editShipToName} onChange={e => setEditShipToName(e.target.value)} placeholder="Clinic name" />
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
                Also save to clinic record
                <span className="block text-xs text-gray-500">
                  Updates the master clinic with the Bill To values, plus both addresses. Future invoices use these defaults.
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
