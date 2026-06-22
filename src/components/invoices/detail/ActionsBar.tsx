'use client'

// Header (number + status/overdue/voided/locked badges) and the workflow action
// bar: Mark Sent, Record Payment (dialog), Mark Paid, Edit link, Print Invoice /
// Delivery, Void (dialog) and Restore. Each mutation calls a Server Action and
// reports through the toast; success triggers `router.refresh()` so the server
// re-renders with fresh data. Payments use the atomic RPCs (record_payment /
// mark_invoice_paid) — we never recompute status client-side.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { formatCurrency, todayISODate } from '@/lib/utils'
import { ArrowLeft, Printer, CreditCard, CheckCircle, Ban, Pencil, Lock } from 'lucide-react'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { isVoided, isOverdue } from '@/lib/invoice-status'
import { statusBadgeVariant } from '@/lib/status-badge'
import {
  markSentAction,
  markInvoicePaidAction,
  recordPaymentAction,
} from '@/data/invoice-actions'
import { voidInvoice as voidInvoiceAction, restoreInvoice } from '@/lib/invoices/void-actions'
import type { InvoiceDetail } from '@/data/invoices'

const paymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  payment_date: z.string().min(1),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
type PaymentForm = z.infer<typeof paymentSchema>

type PrintMode = 'invoice' | 'delivery'

export type ActionsBarProps = {
  invoice: InvoiceDetail
  customerName: string | null
  /** status === 'paid' ? 0 : total - totalPaid */
  outstanding: number
  /** max(0, total - totalPaid) — pre-fills the Record Payment amount. */
  unrecorded: number
  /** Opens the print dialog owned by the document island. */
  onPrint: (mode: PrintMode) => void
}

export function ActionsBar({ invoice, customerName, outstanding, unrecorded, onPrint }: ActionsBarProps) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { show } = useToast()

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [restoring, setRestoring] = useState(false)

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<PaymentForm>({
    // zod's `coerce.number()` types the resolver input as `unknown`; cast to the
    // form's value type so RHF's Resolver generics line up.
    resolver: zodResolver(paymentSchema) as Resolver<PaymentForm>,
    defaultValues: { payment_date: todayISODate() },
  })
  const watchedAmount = useWatch({ control, name: 'amount' })

  const voided = isVoided(invoice)
  const canEdit = canEditInvoice(invoice, hasPermission)
  // Overdue is derived (outstanding + past due), never a stored status value.
  const overdue = !voided && isOverdue(invoice, todayISODate())

  const onRecordPayment = async (data: PaymentForm) => {
    setSavingPayment(true)
    // The atomic RPC inserts the payment row AND advances status in one call;
    // we just refresh afterward — no client-side status recompute.
    const res = await recordPaymentAction(invoice.id, {
      amount: data.amount,
      payment_date: data.payment_date,
      reference: data.reference_number || undefined,
      notes: data.notes || undefined,
    })
    setSavingPayment(false)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    setPaymentOpen(false)
    reset()
    show({ variant: 'success', title: 'Payment recorded' })
    router.refresh()
  }

  const markAsSent = async () => {
    const res = await markSentAction(invoice.id)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Invoice marked as sent' })
    router.refresh()
  }

  const markAsPaid = async () => {
    setMarkingPaid(true)
    // mark_invoice_paid writes a balancing payment so sum(payments) === total.
    const res = await markInvoicePaidAction(invoice.id)
    setMarkingPaid(false)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Invoice marked as paid' })
    router.refresh()
  }

  const voidInvoice = async () => {
    setVoiding(true)
    try {
      const res = await voidInvoiceAction({ id: invoice.id, reason: voidReason })
      if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
      setVoidOpen(false)
      setVoidReason('')
      show({ variant: 'success', title: 'Invoice voided' })
      router.refresh()
    } catch (err) {
      show({ variant: 'error', title: err instanceof Error ? err.message : 'Could not void the invoice. Please try again.' })
    } finally {
      setVoiding(false)
    }
  }

  const restore = async () => {
    setRestoring(true)
    try {
      const res = await restoreInvoice({ id: invoice.id })
      if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
      show({ variant: 'success', title: 'Invoice restored' })
      router.refresh()
    } catch (err) {
      show({ variant: 'error', title: err instanceof Error ? err.message : 'Could not restore the invoice. Please try again.' })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="space-y-4 print:hidden">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{invoice.invoice_number}</h1>
            {overdue
              ? <Badge variant="destructive" className="capitalize">Overdue</Badge>
              : <Badge variant={statusBadgeVariant('payment', invoice.status)} className="capitalize">{invoice.status}</Badge>}
            {voided && (
              <Badge variant="destructive" className="uppercase">Voided</Badge>
            )}
            {!voided && !canEdit && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title="This invoice has been sent. You don't have permission to edit it."
              >
                <Lock className="h-3 w-3" />Locked
              </span>
            )}
          </div>
          <Link href={`/customers/${invoice.customer_id}`} className="text-sm text-primary hover:underline">
            {customerName}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!voided && invoice.status === 'draft' && (
          <Button variant="outline" size="sm" onClick={markAsSent}>Mark as Sent</Button>
        )}
        {/* Record Payment stays available once an invoice is sent — including
            after it's paid — so you can always log the actual bank reference. */}
        {!voided && ['sent', 'partial', 'overdue', 'paid'].includes(invoice.status) && (
          <Button variant="outline" size="sm" onClick={() => { reset({ payment_date: todayISODate(), amount: unrecorded > 0 ? unrecorded : undefined }); setPaymentOpen(true) }}>
            <CreditCard className="h-4 w-4 mr-2" />Record Payment
          </Button>
        )}
        {/* Mark Paid is a shortcut to settle — only meaningful while still unpaid. */}
        {!voided && ['sent', 'partial', 'overdue'].includes(invoice.status) && (
          <Button variant="outline" size="sm" onClick={markAsPaid} disabled={markingPaid}>
            <CheckCircle className="h-4 w-4 mr-2" />Mark Paid
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/invoices/${invoice.id}/edit`}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onPrint('invoice')}>
          <Printer className="h-4 w-4 mr-2" />Print Invoice
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPrint('delivery')}>
          <Printer className="h-4 w-4 mr-2" />Print Delivery
        </Button>
        {hasPermission('invoices.manage') && !voided && (
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
            onClick={() => setVoidOpen(true)}
          >
            <Ban className="h-4 w-4 mr-2" />Void
          </Button>
        )}
        {hasPermission('invoices.manage') && voided && (
          <Button variant="outline" size="sm" onClick={restore} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore'}
          </Button>
        )}
      </div>

      {/* Void confirmation dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="h-5 w-5" /> Void Invoice
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Void <span className="font-semibold">{invoice.invoice_number}</span>? It will be excluded
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
              {!errors.amount && outstanding > 0 && Number(watchedAmount) > outstanding && (
                <p className="text-xs text-amber-600">
                  Exceeds the outstanding balance of {formatCurrency(outstanding)}.
                </p>
              )}
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
