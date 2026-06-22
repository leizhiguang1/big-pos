'use server'

import { getInvoices } from '@/data/invoices'
import { getCustomers } from '@/data/customers'
import { getProducts } from '@/data/products'

export interface CommandItem {
  type: 'invoice' | 'customer' | 'product'
  id: string
  label: string
  sublabel: string
  href: string
}

/** Flat, searchable list of jump targets for the command palette. Dataset is
 *  small (tens of rows); cmdk filters client-side. */
export async function getCommandItems(): Promise<CommandItem[]> {
  const [invoices, customers, products] = await Promise.all([getInvoices(), getCustomers(), getProducts()])

  return [
    ...invoices.map(i => ({
      type: 'invoice' as const,
      id: i.id,
      label: i.invoice_number,
      sublabel: [i.customers?.clinic_name, i.patient].filter(Boolean).join(' · '),
      href: `/invoices/${i.id}`,
    })),
    ...customers.map(c => ({
      type: 'customer' as const,
      id: c.id,
      label: c.clinic_name,
      sublabel: c.contact_person ?? '',
      href: `/customers/${c.id}`,
    })),
    ...products.map(p => ({
      type: 'product' as const,
      id: p.id,
      label: p.name,
      sublabel: `per ${p.unit}`,
      href: '/products',
    })),
  ]
}
