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
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Printer, CreditCard, CheckCircle, Ban } from 'lucide-react'
import type { Invoice, InvoiceItem, Payment, Customer } from '@/lib/database.types'
import { COMPANY, BANK } from '@/lib/config'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info'> = {
  draft: 'secondary', sent: 'info', partial: 'warning', paid: 'success', overdue: 'destructive', void: 'secondary',
}

const paymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  payment_date: z.string().min(1),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
type PaymentForm = z.infer<typeof paymentSchema>

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { payment_date: new Date().toISOString().split('T')[0] },
  })

  const load = async () => {
    if (!id) return
    const [invRes, itemsRes, paymentsRes] = await Promise.all([
      supabase.from('invoices').select('*, customers(*)').eq('id', id).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', id),
      supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date'),
    ])
    if (invRes.data) {
      setInvoice(invRes.data as Invoice)
      setCustomer((invRes.data as Invoice & { customers: Customer }).customers ?? null)
    }
    setItems(itemsRes.data ?? [])
    setPayments(paymentsRes.data ?? [])
    setLoading(false)
  }

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
    await supabase.from('invoices').update({ status: 'void' }).eq('id', invoice.id)
    setVoiding(false)
    setVoidOpen(false)
    load()
  }

  const handlePrint = () => window.print()

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
  if (!invoice) return <p className="text-gray-500">Invoice not found.</p>

  return (
    <div className="max-w-4xl space-y-6">
      {/* Actions bar — hidden on print */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{invoice.invoice_number}</h1>
              <Badge variant={STATUS_VARIANT[invoice.status] ?? 'secondary'} className="capitalize">{invoice.status}</Badge>
            </div>
            <Link href={`/customers/${invoice.customer_id}`} className="text-sm text-primary hover:underline">
              {customer?.clinic_name}
            </Link>
          </div>
        </div>
        <div className="flex gap-2">
          {invoice.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={markAsSent}>Mark as Sent</Button>
          )}
          {['sent', 'partial', 'overdue'].includes(invoice.status) && (
            <>
              <Button variant="outline" size="sm" onClick={() => { reset({ payment_date: new Date().toISOString().split('T')[0], amount: outstanding > 0 ? outstanding : undefined }); setPaymentOpen(true) }}>
                <CreditCard className="h-4 w-4 mr-2" />Record Payment
              </Button>
              <Button variant="outline" size="sm" onClick={markAsPaid} disabled={markingPaid}>
                <CheckCircle className="h-4 w-4 mr-2" />Mark Paid
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />Print
          </Button>
          {invoice.status !== 'void' && (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              onClick={() => setVoidOpen(true)}
            >
              <Ban className="h-4 w-4 mr-2" />Void
            </Button>
          )}
        </div>
      </div>

      {/* Invoice document — also used for printing */}
      <div ref={printRef} className="relative bg-white border rounded-lg p-8 print:border-0 print:p-6 print:shadow-none" id="invoice-print">
        {/* VOID watermark */}
        {invoice.status === 'void' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-lg overflow-hidden">
            <span className="text-red-200 text-[120px] font-black uppercase tracking-widest rotate-[-30deg] select-none opacity-60">
              VOID
            </span>
          </div>
        )}
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <div className="text-2xl font-bold text-primary mb-1">{COMPANY.name}</div>
            <div className="text-sm text-gray-500 whitespace-pre-line">{COMPANY.address}</div>
            {COMPANY.phone && <div className="text-sm text-gray-500">Tel: {COMPANY.phone}</div>}
            {COMPANY.email && <div className="text-sm text-gray-500">{COMPANY.email}</div>}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-200 uppercase tracking-widest mb-2">Invoice</div>
            <div className="text-sm space-y-1">
              <div><span className="text-gray-400">Invoice #: </span><span className="font-semibold">{invoice.invoice_number}</span></div>
              <div><span className="text-gray-400">Date: </span>{formatDate(invoice.invoice_date)}</div>
              <div><span className="text-gray-400">Due: </span>{formatDate(invoice.due_date)}</div>
            </div>
          </div>
        </div>

        {/* Bill To / Deliver To */}
        <div className={`mb-8 grid gap-6 ${customer?.delivery_address ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Bill To</div>
            <div className="font-semibold text-gray-900">{customer?.clinic_name}</div>
            {customer?.contact_person && <div className="text-sm text-gray-600">{customer.contact_person}</div>}
            {customer?.billing_address && <div className="text-sm text-gray-500 whitespace-pre-line">{customer.billing_address}</div>}
            {customer?.phone && <div className="text-sm text-gray-500">Tel: {customer.phone}</div>}
          </div>
          {customer?.delivery_address && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Deliver To</div>
              <div className="font-semibold text-gray-900">{customer?.clinic_name}</div>
              {customer?.contact_person && <div className="text-sm text-gray-600">{customer.contact_person}</div>}
              <div className="text-sm text-gray-500 whitespace-pre-line">{customer.delivery_address}</div>
            </div>
          )}
        </div>

        {/* Line items */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 text-gray-500 font-medium w-1/2">Description</th>
              <th className="text-right py-2 text-gray-500 font-medium">Qty</th>
              <th className="text-right py-2 text-gray-500 font-medium">Unit Price</th>
              <th className="text-right py-2 text-gray-500 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="py-2.5">{item.description}</td>
                <td className="py-2.5 text-right text-gray-600">{item.quantity}</td>
                <td className="py-2.5 text-right text-gray-600">{formatCurrency(item.unit_price)}</td>
                <td className="py-2.5 text-right font-medium">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right font-semibold text-gray-700">Total</td>
              <td className="pt-4 text-right text-lg font-bold text-gray-900">{formatCurrency(invoice.total)}</td>
            </tr>
            {totalPaid > 0 && (
              <>
                <tr>
                  <td colSpan={3} className="pt-1 text-right text-gray-500">Amount Paid</td>
                  <td className="pt-1 text-right text-green-600">({formatCurrency(totalPaid)})</td>
                </tr>
                <tr>
                  <td colSpan={3} className="pt-1 text-right font-semibold text-gray-700">Balance Due</td>
                  <td className="pt-1 text-right font-bold text-red-600">{formatCurrency(outstanding)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>

        {invoice.notes && (
          <div className="mb-6 p-3 bg-gray-50 rounded text-sm text-gray-600">
            <span className="font-medium text-gray-700">Notes: </span>{invoice.notes}
          </div>
        )}

        <Separator className="mb-6" />

        {/* Bank details */}
        <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Payment Details</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div><span className="text-gray-500">Bank: </span><span className="font-medium">{BANK.bankName}</span></div>
            <div><span className="text-gray-500">Account Name: </span><span className="font-medium">{BANK.accountName}</span></div>
            <div><span className="text-gray-500">Account No: </span><span className="font-medium font-mono">{BANK.accountNumber}</span></div>
          </div>
          <p className="text-xs text-primary/60 mt-3 italic">{BANK.paymentNote}</p>
        </div>
      </div>

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

      {/* Void confirmation dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="h-5 w-5" /> Void Invoice
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Are you sure you want to void <span className="font-semibold">{invoice?.invoice_number}</span>?
            This cannot be undone. The invoice will be marked as void and excluded from revenue reports.
          </p>
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
