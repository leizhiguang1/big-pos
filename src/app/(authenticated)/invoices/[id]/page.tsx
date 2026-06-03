'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Printer, CreditCard, CheckCircle, Ban, ChevronRight, Pencil, Lock } from 'lucide-react'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { isVoided } from '@/lib/invoice-status'
import { voidInvoice as voidInvoiceAction, restoreInvoice } from '@/lib/invoices/void-actions'
import type { Invoice, InvoiceItem, InvoiceItemStatusHistory, Payment, Customer, WorkStatus, ServiceStatus, Product } from '@/lib/database.types'
import { COMPANY, BANK } from '@/lib/config'
import { cn } from '@/lib/utils'
import { WORK_STATUSES, WORK_STATUS_LABELS, WORK_STATUS_COLORS } from '@/lib/work-status'
import { WorkStatusBadge } from '@/components/work-status-badge'
import { fetchActiveServiceStatuses, DEFAULT_COLOR } from '@/lib/service-status'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  draft: 'secondary', sent: 'info', partial: 'warning', paid: 'success', overdue: 'destructive',
}

const paymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  payment_date: z.string().min(1),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
type PaymentForm = z.infer<typeof paymentSchema>

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
  notes: string
  instructions: string
  itemOverrides: Record<string, ItemOverride>
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, role, isAdmin } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [patient, setPatient] = useState('')
  const [doctor, setDoctor] = useState('')
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatus[]>([])
  const [serviceStatusId, setServiceStatusId] = useState<string | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [history, setHistory] = useState<InvoiceItemStatusHistory[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [restoring, setRestoring] = useState(false)
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
  const [printMode, setPrintMode] = useState<PrintMode>('invoice')
  const [printNonce, setPrintNonce] = useState(0)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<PrintMode>('invoice')
  const [printDraft, setPrintDraft] = useState<PrintOverrides | null>(null)
  const [printOverrides, setPrintOverrides] = useState<PrintOverrides | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { payment_date: new Date().toISOString().split('T')[0] },
  })

  const load = async () => {
    if (!id) return
    const [invRes, itemsRes, paymentsRes, ssRes, prodRes] = await Promise.all([
      supabase.from('invoices').select('*, customers(*), service_statuses(*)').eq('id', id).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
      fetchActiveServiceStatuses(),
      supabase.from('products').select('*').eq('active', true).order('created_at'),
    ])
    setProducts(prodRes.data ?? [])
    if (invRes.data) {
      const inv = invRes.data as Invoice
      setInvoice(inv)
      setCustomer((invRes.data as Invoice & { customers: Customer }).customers ?? null)
      setPatient(inv.patient ?? '')
      setDoctor(inv.doctor ?? '')
      setServiceStatusId(inv.service_status_id)
    }
    setServiceStatuses(ssRes)
    const itemRows = itemsRes.data ?? []
    setItems(itemRows)
    setPayments(paymentsRes.data ?? [])
    if (itemRows.length > 0) {
      const { data: histRows } = await supabase
        .from('invoice_item_status_history')
        .select('*')
        .in('invoice_item_id', itemRows.map(i => i.id))
        .order('changed_at', { ascending: false })
      setHistory(histRows ?? [])
    } else {
      setHistory([])
    }
    setLoading(false)
  }

  const updateWorkStatus = async (itemId: string, status: WorkStatus) => {
    await supabase.from('invoice_items').update({ work_status: status }).eq('id', itemId)
    load()
  }

  const savePatientDoctor = async () => {
    if (!invoice) return
    const next = { patient: patient || null, doctor: doctor || null }
    if (next.patient === invoice.patient && next.doctor === invoice.doctor) return
    await supabase.from('invoices').update(next).eq('id', invoice.id)
    setInvoice({ ...invoice, ...next })
  }

  const updateServiceStatus = async (nextId: string | null) => {
    if (!invoice) return
    setServiceStatusId(nextId)
    await supabase.from('invoices').update({ service_status_id: nextId }).eq('id', invoice.id)
    load()
  }

  const currentServiceStatus = serviceStatuses.find(s => s.id === serviceStatusId)
    ?? (invoice?.service_statuses ?? null)

  useEffect(() => { load() }, [id])

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const outstanding = invoice ? Number(invoice.total) - totalPaid : 0

  const onRecordPayment = async (data: PaymentForm) => {
    if (!invoice || !user) return
    setSavingPayment(true)
    await supabase.from('payments').insert({
      invoice_id: invoice.id,
      amount: data.amount,
      payment_date: data.payment_date,
      reference_number: data.reference_number || null,
      notes: data.notes || null,
      created_by: user.id,
    })
    const newPaid = totalPaid + data.amount
    const newStatus = newPaid >= Number(invoice.total) ? 'paid' : 'partial'
    await supabase.from('invoices').update({ status: newStatus }).eq('id', invoice.id)
    setPaymentOpen(false)
    reset()
    setSavingPayment(false)
    load()
  }

  const markAsSent = async () => {
    if (!invoice) return
    await supabase.from('invoices').update({ status: 'sent' }).eq('id', invoice.id)
    load()
  }

  const markAsPaid = async () => {
    if (!invoice) return
    setMarkingPaid(true)
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id)
    setMarkingPaid(false)
    load()
  }

  const voidInvoice = async () => {
    if (!invoice) return
    setVoiding(true)
    const res = await voidInvoiceAction({ id: invoice.id, reason: voidReason })
    setVoiding(false)
    setVoidOpen(false)
    setVoidReason('')
    if (!res.ok) { alert(res.error); return }
    load()
  }

  const restore = async () => {
    if (!invoice) return
    setRestoring(true)
    const res = await restoreInvoice({ id: invoice.id })
    setRestoring(false)
    if (!res.ok) { alert(res.error); return }
    load()
  }

  const openRecipientDialog = () => {
    if (!invoice) return
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
    if (!invoice) return
    setSavingRecipient(true)
    const nextBillName = editBillToName.trim() || null
    const nextBillContact = editBillToContact.trim() || null
    const nextBillPhone = editBillToPhone.trim() || null
    const nextBilling = editBilling.trim() || null
    const nextShipName = editShipToName.trim() || null
    const nextShipContact = editShipToContact.trim() || null
    const nextDelivery = editDelivery.trim() || null
    await supabase
      .from('invoices')
      .update({
        bill_to_name: nextBillName,
        bill_to_contact: nextBillContact,
        bill_to_phone: nextBillPhone,
        billing_address: nextBilling,
        ship_to_name: nextShipName,
        ship_to_contact: nextShipContact,
        delivery_address: nextDelivery,
      })
      .eq('id', invoice.id)
    if (alsoSaveToCustomer && invoice.customer_id) {
      const customerUpdate: Record<string, string | null> = {
        contact_person: nextBillContact,
        phone: nextBillPhone,
        billing_address: nextBilling,
        delivery_address: nextDelivery,
      }
      if (nextBillName) customerUpdate.clinic_name = nextBillName
      await supabase
        .from('customers')
        .update(customerUpdate)
        .eq('id', invoice.customer_id)
    }
    setSavingRecipient(false)
    setRecipientOpen(false)
    load()
  }

  const openPrintDialog = (mode: PrintMode) => {
    if (!invoice) return
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
      serviceStatusId: serviceStatusId ?? invoice.service_status_id,
      notes: invoice.notes ?? '',
      instructions: '',
      itemOverrides: Object.fromEntries(items.map(it => [it.id, {
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
      }])),
    })
    setPrintDialogOpen(true)
  }

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

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
  if (!invoice) return <p className="text-gray-500">Invoice not found.</p>

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
        notes:           o ? o.notes           : invoice.notes,
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
                    <td className="pt-1 text-right font-bold text-red-600">{formatCurrency(previewTotal - totalPaid)}</td>
                  </tr>
                </>
              )}
            </tfoot>
          )}
        </table>

        {field.notes && (
          <div className="mb-6 p-3 bg-gray-50 rounded text-sm text-gray-600">
            <span className="font-medium text-gray-700">Notes: </span>{field.notes}
          </div>
        )}

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

  // Content editing (Edit form, recipient, patient/doctor) is gated by status + role.
  // Workflow actions (payments, mark sent/paid, void, print) are unaffected.
  const voided = isVoided(invoice)
  const canEdit = canEditInvoice(invoice, role)

  return (
    <div className="max-w-4xl space-y-6">
      {/* Actions bar — hidden on print */}
      <div className="space-y-4 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{invoice.invoice_number}</h1>
              <Badge variant={STATUS_VARIANT[invoice.status] ?? 'secondary'} className="capitalize">{invoice.status}</Badge>
              {voided && (
                <Badge variant="destructive" className="uppercase">Voided</Badge>
              )}
              {!voided && !canEdit && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-gray-500"
                  title="This invoice has been sent. Only an admin can edit it."
                >
                  <Lock className="h-3 w-3" />Locked
                </span>
              )}
            </div>
            <Link href={`/customers/${invoice.customer_id}`} className="text-sm text-primary hover:underline">
              {customer?.clinic_name}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!voided && invoice.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={markAsSent}>Mark as Sent</Button>
          )}
          {!voided && ['sent', 'partial', 'overdue'].includes(invoice.status) && (
            <>
              <Button variant="outline" size="sm" onClick={() => { reset({ payment_date: new Date().toISOString().split('T')[0], amount: outstanding > 0 ? outstanding : undefined }); setPaymentOpen(true) }}>
                <CreditCard className="h-4 w-4 mr-2" />Record Payment
              </Button>
              <Button variant="outline" size="sm" onClick={markAsPaid} disabled={markingPaid}>
                <CheckCircle className="h-4 w-4 mr-2" />Mark Paid
              </Button>
            </>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/invoices/${invoice.id}/edit`}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openPrintDialog('invoice')}>
            <Printer className="h-4 w-4 mr-2" />Print Invoice
          </Button>
          <Button variant="outline" size="sm" onClick={() => openPrintDialog('delivery')}>
            <Printer className="h-4 w-4 mr-2" />Print Delivery
          </Button>
          {isAdmin && !voided && (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              onClick={() => setVoidOpen(true)}
            >
              <Ban className="h-4 w-4 mr-2" />Void
            </Button>
          )}
          {isAdmin && voided && (
            <Button variant="outline" size="sm" onClick={restore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Restore'}
            </Button>
          )}
        </div>
      </div>

      {/* Invoice document — also used for printing */}
      <div ref={printRef} className="relative bg-white border rounded-lg p-8 print:border-0 print:p-6 print:shadow-none" id="invoice-print">
        {renderDocBody({ mode: printMode, resolved: printResolved, showInlineEdit: true })}
      </div>

      {/* Case details — editable, hidden on print */}
      {!voided && (
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">Case Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Patient</Label>
                {canEdit ? (
                  <Input
                    placeholder="Patient name"
                    value={patient}
                    onChange={e => setPatient(e.target.value)}
                    onBlur={savePatientDoctor}
                  />
                ) : (
                  <p className="py-2 text-sm text-gray-900">{patient || '—'}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Doctor</Label>
                {canEdit ? (
                  <Input
                    placeholder="Doctor name"
                    value={doctor}
                    onChange={e => setDoctor(e.target.value)}
                    onBlur={savePatientDoctor}
                  />
                ) : (
                  <p className="py-2 text-sm text-gray-900">{doctor || '—'}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service status — what the lab is telling the doctor (Try in / Redo / …) */}
      {!voided && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Service Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={serviceStatusId ?? '__none__'}
                  onValueChange={v => updateServiceStatus(v === '__none__' ? null : v)}
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
                {serviceStatuses.length === 0 && (
                  <p className="text-xs text-gray-500">
                    No statuses configured.{' '}
                    <Link href="/settings/service-statuses" className="text-primary hover:underline">
                      Add some in Settings
                    </Link>.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Work status — hidden on print */}
      {!voided && items.length > 0 && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Work Status</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                  <TableHead className="w-44 text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>
                      <Select
                        value={item.work_status}
                        onValueChange={v => updateWorkStatus(item.id, v as WorkStatus)}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-8 w-36 text-xs font-medium border-transparent',
                            WORK_STATUS_COLORS[item.work_status]
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WORK_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{WORK_STATUS_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-xs text-gray-500">
                      {formatDate(item.work_status_updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {history.length > 0 && (
              <div className="border-t">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <span>Work history ({history.length} change{history.length === 1 ? '' : 's'})</span>
                  <ChevronRight className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
                </button>
                {historyOpen && (
                  <div className="px-4 pb-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map(h => {
                          const item = items.find(i => i.id === h.invoice_item_id)
                          return (
                            <TableRow key={h.id}>
                              <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                                {new Date(h.changed_at).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-sm">{item?.description ?? '—'}</TableCell>
                              <TableCell>
                                <WorkStatusBadge status={h.status} />
                              </TableCell>
                              <TableCell className="text-sm text-gray-600">
                                {h.changed_by_name ?? '—'}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment history — hidden on print */}
      {payments.length > 0 && (
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                    <TableCell className="text-sm font-mono">{p.reference_number ?? '—'}</TableCell>
                    <TableCell className="text-sm text-gray-500">{p.notes ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">{formatCurrency(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">Outstanding</TableCell>
                  <TableCell className="text-right font-bold text-red-600">{formatCurrency(outstanding)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

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
                                min="0"
                                value={ov?.quantity ?? 0}
                                onChange={e => updateItem({ quantity: Number(e.target.value) || 0 })}
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

                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500">Notes</Label>
                    <Textarea rows={2} value={printDraft.notes} onChange={e => setPrintDraft(d => d && ({ ...d, notes: e.target.value }))} />
                  </div>

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

      {/* Void confirmation dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="h-5 w-5" /> Void Invoice
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Void <span className="font-semibold">{invoice?.invoice_number}</span>? It will be excluded
            from revenue and reports. You can restore it later.
          </p>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="e.g. duplicate, entry error" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={voidInvoice}
              disabled={voiding}
            >
              {voiding ? 'Voiding…' : 'Yes, Void Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onRecordPayment)} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (MYR) *</Label>
              <Input type="number" min="0.01" step="0.01" {...register('amount')} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Payment Date *</Label>
              <Input type="date" {...register('payment_date')} />
            </div>
            <div className="space-y-2">
              <Label>Bank Transfer Reference</Label>
              <Input placeholder="e.g. TT123456" {...register('reference_number')} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes…" {...register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingPayment}>{savingPayment ? 'Saving…' : 'Record Payment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
