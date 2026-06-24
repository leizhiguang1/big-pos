'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { updateBillingSettings } from '@/data/billing-settings'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import type { BillingSettings } from '@/lib/config'

type BillingSettingsFormProps = {
  settings: BillingSettings
}

export function BillingSettingsForm({ settings }: BillingSettingsFormProps) {
  const router = useRouter()
  const { show } = useToast()
  const [bankName, setBankName] = useState(settings.bankName)
  const [accountName, setAccountName] = useState(settings.accountName)
  const [accountNumber, setAccountNumber] = useState(settings.accountNumber)
  const [paymentNote, setPaymentNote] = useState(settings.paymentNote)
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(settings.paymentTermsDays))
  const [invoiceNotesText, setInvoiceNotesText] = useState(settings.invoiceNotes.join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invoiceNotes = invoiceNotesText
    .split('\n')
    .map(note => note.trim())
    .filter(Boolean)

  const save = async () => {
    setSaving(true)
    setError(null)
    const result = await updateBillingSettings({
      bankName,
      accountName,
      accountNumber,
      paymentNote,
      invoiceNotes,
      paymentTermsDays: Number(paymentTermsDays),
    })
    setSaving(false)

    if (result.ok === false) {
      setError(result.error)
      show({ variant: 'error', title: result.error })
      return
    }

    show({ variant: 'success', title: 'Billing settings saved' })
    router.refresh()
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bankName">Bank *</Label>
              <Input
                id="bankName"
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="Public Bank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account No *</Label>
              <Input
                id="accountNumber"
                value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)}
                placeholder="3249402703"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountName">Account Name *</Label>
            <Input
              id="accountName"
              value={accountName}
              onChange={e => setAccountName(e.target.value)}
              placeholder="Chi Dental Lab Sdn Bhd"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentNote">Payment Note</Label>
            <Input
              id="paymentNote"
              value={paymentNote}
              onChange={e => setPaymentNote(e.target.value)}
              placeholder="Please use invoice number as payment reference"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentTermsDays">Payment Terms (days)</Label>
            <Input
              id="paymentTermsDays"
              type="number"
              min={1}
              step={1}
              className="sm:w-32"
              value={paymentTermsDays}
              onChange={e => setPaymentTermsDays(e.target.value)}
              placeholder="30"
            />
            <p className="text-xs text-muted-foreground">
              Sets each new invoice&rsquo;s due date (invoice date + this). Existing invoices keep their saved due date.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoiceNotes">Invoice Notes</Label>
            <Textarea
              id="invoiceNotes"
              rows={3}
              value={invoiceNotesText}
              onChange={e => setInvoiceNotesText(e.target.value)}
              placeholder="One printed note per line"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button className="w-full sm:w-auto" type="button" onClick={save} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment Details</p>
              <div className="mt-3 grid gap-1.5 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                <span className="text-muted-foreground">Bank</span>
                <span className="font-medium">{bankName}</span>
                <span className="text-muted-foreground">Account Name</span>
                <span className="font-medium">{accountName}</span>
                <span className="text-muted-foreground">Account No</span>
                <span className="font-mono font-medium">{accountNumber}</span>
              </div>
              {paymentNote.trim() && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{paymentNote.trim()}</p>
              )}
            </div>
            {invoiceNotes.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Note</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm leading-relaxed text-foreground">
                    {invoiceNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                  </ol>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Sent, paid, overdue, partial, and voided invoices keep the payment details saved on that invoice.
        </p>
      </div>
    </div>
  )
}
