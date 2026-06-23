'use client'

// "Issue credit" button + dialog on the clinic detail page. A credit is a
// non-payment reduction of the clinic's account (remake / return / goodwill).
// Gated behind `invoices.manage` — the SAME permission as Record Payment, since
// the write action enforces it server-side too. On success we `router.refresh()`
// so the server re-renders the clinic's account balance + credits card.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { todayISODate } from '@/lib/utils'
import { CREDIT_REASON_OPTIONS } from '@/lib/credit'
import { createCreditAction } from '@/data/credits'
import type { CreditReason } from '@/lib/database.types'

// The minimal invoice shape the "against invoice" picker needs.
export type CreditInvoiceOption = {
  id: string
  invoice_number: string
}

// Sentinel for "no invoice" — Radix Select can't hold an empty-string value.
const NO_INVOICE = '__none__'

export function IssueCreditDialog({
  customerId,
  invoices,
}: {
  customerId: string
  invoices: CreditInvoiceOption[]
}) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { show } = useToast()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<CreditReason>('remake')
  const [invoiceId, setInvoiceId] = useState<string>(NO_INVOICE)
  const [creditDate, setCreditDate] = useState(todayISODate())
  const [notes, setNotes] = useState('')

  // Mirror the Void/Record-Payment gating: only show to roles that can manage
  // billing. The server action re-checks this permission regardless.
  if (!hasPermission('invoices.manage')) return null

  const reset = () => {
    setAmount('')
    setReason('remake')
    setInvoiceId(NO_INVOICE)
    setCreditDate(todayISODate())
    setNotes('')
  }

  const submit = async () => {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      show({ variant: 'error', title: 'Enter an amount greater than 0' })
      return
    }
    setSaving(true)
    const res = await createCreditAction(customerId, {
      amount: amt,
      reason,
      invoice_id: invoiceId === NO_INVOICE ? null : invoiceId,
      credit_date: creditDate,
      notes: notes || undefined,
    })
    setSaving(false)
    if (res.ok === false) {
      show({ variant: 'error', title: (res as { error: string }).error })
      return
    }
    setOpen(false)
    reset()
    show({ variant: 'success', title: 'Credit issued' })
    router.refresh()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { reset(); setOpen(true) }}
      >
        <Plus className="h-4 w-4 mr-2" />Issue credit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue Account Credit</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (MYR) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as CreditReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDIT_REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Against invoice</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue placeholder="Clinic-level (no invoice)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INVOICE}>Clinic-level (no invoice)</SelectItem>
                  {invoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Issue Credit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
