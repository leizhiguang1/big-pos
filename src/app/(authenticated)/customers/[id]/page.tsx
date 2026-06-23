// Customer detail — server-first. This Server Component fetches the customer +
// its invoices via `getCustomerDetail`, derives the billing totals, and renders
// the static contact/summary cards server-side. The interactive header (back +
// gated Edit/New) and the clickable invoice history are client islands.

import { notFound } from 'next/navigation'
import { getCustomerDetail } from '@/data/customers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn, formatCurrency, todayISODate } from '@/lib/utils'
import { summarizeCustomerInvoices, arAging } from '@/lib/invoice-status'
import { Phone, Mail, MapPin, Truck, MessageCircle } from 'lucide-react'
import { CustomerDetailHeader } from '@/components/customers/CustomerDetailHeader'
import { CustomerInvoiceHistory } from '@/components/customers/CustomerInvoiceHistory'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getCustomerDetail(id)
  if (!data) notFound()

  const { customer, invoices } = data
  const { totalBilled, totalOutstanding } = summarizeCustomerInvoices(invoices)
  const aging = arAging(invoices, todayISODate())

  return (
    <div className="space-y-6 max-w-4xl">
      <CustomerDetailHeader id={id} clinicName={customer.clinic_name} contactPerson={customer.contact_person} />

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Contact Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${customer.phone}`} className="text-primary hover:underline">{customer.phone}</a>
                <a
                  href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <MessageCircle className="h-3.5 w-3.5" />WhatsApp
                </a>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${customer.email}`} className="text-primary hover:underline">{customer.email}</a>
              </div>
            )}
            {(customer.billing_address || customer.delivery_address) && (
              <Separator />
            )}
            {customer.billing_address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Billing Address</p>
                  <span className="whitespace-pre-line">{customer.billing_address}</span>
                </div>
              </div>
            )}
            {customer.delivery_address && (
              <div className="flex items-start gap-2 text-sm">
                <Truck className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Delivery Address</p>
                  <span className="whitespace-pre-line">{customer.delivery_address}</span>
                </div>
              </div>
            )}
            {customer.notes && (
              <>
                <Separator />
                <p className="text-sm text-muted-foreground italic">{customer.notes}</p>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Billed</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalBilled)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-xl font-bold text-yellow-600 mt-1">{formatCurrency(totalOutstanding)}</p>
            </CardContent>
          </Card>
          {totalOutstanding > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">A/R Aging</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {[
                  { label: 'Current', value: aging.current },
                  { label: '1–30 days', value: aging.d1_30 },
                  { label: '31–60 days', value: aging.d31_60 },
                  { label: '61–90 days', value: aging.d61_90 },
                  { label: '90+ days', value: aging.d90plus, danger: true },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={cn('font-medium tabular-nums', row.danger && row.value > 0 && 'text-red-600')}>
                      {formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CustomerInvoiceHistory invoices={invoices} />
    </div>
  )
}
