'use client'

// Thin orchestrator that wires the two coupled chrome islands together: the
// ActionsBar's Print buttons need to open the print dialog that lives inside the
// InvoiceDocument island. They share a mutable opener via a ref, so neither has
// to hoist the print dialog's state. `canEdit` (for the recipient pencil) is
// derived here from the client auth context.

import { useRef, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { isVoided } from '@/lib/invoice-status'
import { ActionsBar } from './ActionsBar'
import { InvoiceDocument } from './InvoiceDocument'
import type { InvoiceItem, Product, ServiceStatus, WorkStage, WorkStatusConfig } from '@/lib/database.types'
import type { InvoiceDetail } from '@/data/invoices'
import type { BillingSettings } from '@/lib/config'

type PrintMode = 'invoice' | 'delivery' | 'work_ticket'

export type InvoiceDetailClientProps = {
  invoice: InvoiceDetail
  items: InvoiceItem[]
  products: Product[]
  serviceStatuses: ServiceStatus[]
  currentServiceStatus: ServiceStatus | null
  /** Work stages — used to label per-item production status on the bench work ticket. */
  stages: WorkStage[]
  workStatusConfigs: WorkStatusConfig[]
  customerName: string | null
  totalPaid: number
  unrecorded: number
  billingSettings: BillingSettings
  /** Editors + status strip, rendered between the actions bar and the printable document. */
  children?: ReactNode
}

export function InvoiceDetailClient({
  invoice,
  items,
  products,
  serviceStatuses,
  currentServiceStatus,
  stages,
  workStatusConfigs,
  customerName,
  totalPaid,
  unrecorded,
  billingSettings,
  children,
}: InvoiceDetailClientProps) {
  const { hasPermission } = useAuth()
  const printOpenRef = useRef<(mode: PrintMode) => void>(() => {})

  const canEdit = canEditInvoice(invoice, hasPermission) && !isVoided(invoice)

  return (
    <>
      <ActionsBar
        invoice={invoice}
        customerName={customerName}
        unrecorded={unrecorded}
        onPrint={mode => printOpenRef.current(mode)}
      />
      {children}
      <InvoiceDocument
        invoice={invoice}
        items={items}
        products={products}
        serviceStatuses={serviceStatuses}
        currentServiceStatus={currentServiceStatus}
        stages={stages}
        workStatusConfigs={workStatusConfigs}
        totalPaid={totalPaid}
        billingSettings={billingSettings}
        canEdit={canEdit}
        onPrintReady={open => { printOpenRef.current = open }}
      />
    </>
  )
}
