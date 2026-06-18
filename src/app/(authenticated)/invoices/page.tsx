import { getInvoices } from '@/data/invoices'
import { InvoiceListClient } from '@/components/invoices/InvoiceListClient'

export default async function InvoicesPage() {
  const invoices = await getInvoices()
  return <InvoiceListClient invoices={invoices} />
}
