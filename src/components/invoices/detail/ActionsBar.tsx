'use client'

// Header (number + status/overdue/voided/locked badges) and the workflow action
// bar: Mark Sent, Record Payment (dialog), Edit link, Print Invoice / Delivery,
// Void (dialog) and Restore. Each mutation calls a Server Action and reports
// through the toast; success triggers `router.refresh()` so the server re-renders
// with fresh data. Payment goes through the atomic `record_payment` RPC, which
// records the full outstanding balance and advances status — we never recompute
// status client-side.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, type Resolver } from 'react-hook-form'
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
import { cn, formatCurrency, todayISODate } from '@/lib/utils'
import { ArrowLeft, Printer, CreditCard, Ban, Pencil, Lock, ChevronDown, FileText, Truck } from 'lucide-react'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { isVoided, isOverdue } from '@/lib/invoice-status'
import { statusBadgeVariant } from '@/lib/status-badge'
import {
  markSentAction,
  recordPaymentAction,
} from '@/data/invoice-actions'
import { voidInvoice as voidInvoiceAction, restoreInvoice } from '@/lib/invoices/void-actions'
import type { InvoiceDetail } from '@/data/invoices'

const paymentSchema = z.object({
  payment_date: z.string().min(1),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
type PaymentForm = z.infer<typeof paymentSchema>

type PrintMode = 'invoice' | 'delivery' | 'work_ticket'

export type ActionsBarProps = {
  invoice: InvoiceDetail
  customerName: string | null
  /** max(0, total - totalPaid) — the full balance recorded by Record Payment. */
  unrecorded: number
  /** Opens the print dialog owned by the document island. */
  onPrint: (mode: PrintMode) => void
}

// Single "Print" entry point that reveals the printable documents (Invoice and
// Delivery Note) on hover or click — keeping print apart from the workflow
// actions. Work Ticket prints are still wired through `onPrint` in the document
// island but are no longer surfaced here. Hover opens with a small close delay
// so moving the cursor from the button onto the panel doesn't dismiss it;
// click toggles it for touch/keyboard, with outside-click and Escape to close.
function PrintMenu({ onPrint, className }: { onPrint: (mode: PrintMode) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openNow = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 140)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Clean up the pending close timer on unmount.
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const choose = (mode: PrintMode) => { setOpen(false); onPrint(mode) }

  const items: { mode: PrintMode; label: string; description: string; icon: typeof FileText }[] = [
    { mode: 'invoice', label: 'Invoice', description: 'Prices, totals & bank details', icon: FileText },
    { mode: 'delivery', label: 'Delivery Note', description: 'Items & quantities, no prices', icon: Truck },
  ]

  return (
    <div ref={containerRef} className={cn('relative', className)} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Printer className="h-4 w-4 mr-2" />Print
        <ChevronDown className={cn('h-4 w-4 ml-1.5 opacity-60 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[14rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {items.map(({ mode, label, description, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              onClick={() => choose(mode)}
              className="flex w-full items-start gap-2.5 rounded-sm px-2 py-2 text-left outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
              <span className="flex flex-col">
                <span className="text-sm font-medium leading-none">{label}</span>
                <span className="mt-1 text-xs text-muted-foreground">{description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ActionsBar({ invoice, customerName, unrecorded, onPrint }: ActionsBarProps) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { show } = useToast()

  const [paymentOpen, setPaymentOpen] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [restoring, setRestoring] = useState(false)

  const { register, handleSubmit, reset } = useForm<PaymentForm>({
    // Cast keeps RHF's Resolver generics aligned with the zod schema's inferred type.
    resolver: zodResolver(paymentSchema) as Resolver<PaymentForm>,
    defaultValues: { payment_date: todayISODate() },
  })

  const voided = isVoided(invoice)
  const canEdit = canEditInvoice(invoice, hasPermission)
  // Overdue is derived (outstanding + past due), never a stored status value.
  const overdue = !voided && isOverdue(invoice, todayISODate())

  const onRecordPayment = async (data: PaymentForm) => {
    setSavingPayment(true)
    // The atomic RPC inserts the payment row AND advances status in one call;
    // amount is always the full outstanding balance. We refresh afterward —
    // no client-side status recompute.
    const res = await recordPaymentAction(invoice.id, {
      amount: unrecorded,
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

  const voidInvoice = async () => {
    setVoiding(true)
    try {
      const res = await voidInvoiceAction({ id: invoice.id, reason: voidReason })
      if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
      setVoidOpen(false)
      setVoidReason('')
      show({ variant: 'success', title: 'Invoice voided' })
      router.refresh()
    } catch {
      // The action returns a friendly message via `res.error`; this only fires
      // on an unexpected client/transport failure. Keep it generic — never
      // surface a raw (masked) server error string to the user.
      show({ variant: 'error', title: 'Could not void the invoice. Please try again.' })
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
    } catch {
      show({ variant: 'error', title: 'Could not restore the invoice. Please try again.' })
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
      <div className="flex flex-wrap items-center gap-2">
        {!voided && invoice.status === 'draft' && (
          <Button variant="outline" size="sm" onClick={markAsSent}>Mark as Sent</Button>
        )}
        {/* Record Payment is the single settle action: it records the full
            outstanding balance and marks the invoice paid. Hidden once paid so
            a second full payment can't be recorded. */}
        {!voided && ['sent', 'partial', 'overdue'].includes(invoice.status) && (
          <Button variant="outline" size="sm" onClick={() => { reset({ payment_date: todayISODate() }); setPaymentOpen(true) }}>
            <CreditCard className="h-4 w-4 mr-2" />Record Payment
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/invoices/${invoice.id}/edit`}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Link>
          </Button>
        )}
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
        {/* Print is kept apart from the workflow actions: a single entry point on
            the right that reveals the printable documents on hover or click. */}
        <PrintMenu onPrint={onPrint} className="ml-auto" />
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
            <div className="space-y-1">
              <Label>Amount (MYR)</Label>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(unrecorded)}</p>
              <p className="text-xs text-muted-foreground">Full outstanding balance — recorded as a single payment.</p>
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
              <Button type="submit" disabled={savingPayment || unrecorded <= 0}>{savingPayment ? 'Saving…' : 'Record Payment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
