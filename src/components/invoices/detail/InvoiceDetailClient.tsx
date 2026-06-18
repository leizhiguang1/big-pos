'use client'

// Thin orchestrator that wires the two coupled chrome islands together: the
// ActionsBar's Print buttons need to open the print dialog that lives inside the
// InvoiceDocument island. They share a mutable opener via a ref, so neither has
// to hoist the print dialog's state. `canEdit` (for the recipient pencil) is
// derived here from the client auth context.

import { useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { isVoided } from '@/lib/invoice-status'
import { ActionsBar } from './ActionsBar'
import { InvoiceDocument } from './InvoiceDocument'
import type { InvoiceItem, Product, ServiceStatus } from '@/lib/database.types'
import type { InvoiceDetail } from '@/data/invoices'

type PrintMode = 'invoice' | 'delivery'

export type InvoiceDetailClientProps = {
  invoice: InvoiceDetail
  items: InvoiceItem[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
  currentServiceStatus: ServiceStatus | null
  customerName: string | null
  totalPaid: number
  outstanding: number
  unrecorded: number
}

export function InvoiceDetailClient({
  invoice,
  items,
  products,
  serviceStatuses,
  currentServiceStatus,
  customerName,
  totalPaid,
  outstanding,
  unrecorded,
}: InvoiceDetailClientProps) {
  const { hasPermission } = useAuth()
  const printOpenRef = useRef<(mode: PrintMode) => void>(() => {})

  const canEdit = canEditInvoice(invoice, hasPermission) && !isVoided(invoice)

  return (
    <>
      <ActionsBar
        invoice={invoice}
        customerName={customerName}
        outstanding={outstanding}
        unrecorded={unrecorded}
        onPrint={mode => printOpenRef.current(mode)}
      />
      <InvoiceDocument
        invoice={invoice}
        items={items}
        products={products}
        serviceStatuses={serviceStatuses}
        currentServiceStatus={currentServiceStatus}
        totalPaid={totalPaid}
        canEdit={canEdit}
        onPrintReady={open => { printOpenRef.current = open }}
      />
    </>
  )
}
