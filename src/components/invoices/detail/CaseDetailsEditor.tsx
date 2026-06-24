'use client'

// Case details card. Patient / Doctor are content-edit gated; Service Status is
// kept in the same visual container and still writes through the server action.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ServiceStatusSelectItem } from '@/components/invoices/ServiceStatusSelectItem'
import { ManageOptionsLink } from '@/components/ui/manage-options-link'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { DEFAULT_COLOR } from '@/lib/service-status'
import { cn } from '@/lib/utils'
import { updateCaseDetailsAction, updateServiceStatusAction } from '@/data/invoice-actions'
import type { ServiceStatus } from '@/lib/database.types'
import type { InvoiceDetail } from '@/data/invoices'

export type CaseDetailsEditorProps = {
  invoice: Pick<InvoiceDetail, 'id' | 'status' | 'voided_at' | 'patient' | 'doctor'>
  serviceStatusId: string | null
  serviceStatuses: ServiceStatus[]
}

export function CaseDetailsEditor({ invoice, serviceStatusId: initialServiceStatusId, serviceStatuses }: CaseDetailsEditorProps) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { show } = useToast()
  const invoiceId = invoice.id
  const patientProp = invoice.patient
  const doctorProp = invoice.doctor
  const [patient, setPatient] = useState(patientProp ?? '')
  const [doctor, setDoctor] = useState(doctorProp ?? '')
  const [serviceStatusId, setServiceStatusId] = useState<string | null>(initialServiceStatusId)
  // Inputs are editable only when content-edit gating allows it (matches the
  // original page's `canEdit = canEditInvoice(invoice, hasPermission)`).
  const canEdit = canEditInvoice(invoice, hasPermission)
  const currentServiceStatus = serviceStatuses.find(s => s.id === serviceStatusId)

  const save = async () => {
    const next = { patient: patient || null, doctor: doctor || null }
    if (next.patient === (patientProp ?? null) && next.doctor === (doctorProp ?? null)) return
    const res = await updateCaseDetailsAction(invoiceId, next)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Case details updated' })
    router.refresh()
  }

  const updateServiceStatus = async (nextId: string | null) => {
    const prev = serviceStatusId
    setServiceStatusId(nextId)
    const res = await updateServiceStatusAction(invoiceId, nextId)
    if (res.ok === false) { setServiceStatusId(prev); show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Service status updated' })
    router.refresh()
  }

  return (
    <Card className="print:hidden">
      <CardHeader><CardTitle className="text-base">Case Details</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Patient</Label>
            {canEdit ? (
              <Input
                placeholder="Patient name"
                value={patient}
                onChange={e => setPatient(e.target.value)}
                onBlur={save}
              />
            ) : (
              <p className="flex h-10 items-center text-sm text-gray-900">{patient || '—'}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Doctor</Label>
            {canEdit ? (
              <Input
                placeholder="Doctor name"
                value={doctor}
                onChange={e => setDoctor(e.target.value)}
                onBlur={save}
              />
            ) : (
              <p className="flex h-10 items-center text-sm text-gray-900">{doctor || '—'}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Service Status</Label>
            <Select
              value={serviceStatusId ?? '__none__'}
              onValueChange={v => updateServiceStatus(v === '__none__' ? null : v)}
            >
              <SelectTrigger
                className={cn(
                  'h-10 w-full text-sm font-medium',
                  currentServiceStatus ? cn('border-transparent', currentServiceStatus.color ?? DEFAULT_COLOR) : '',
                )}
              >
                <SelectValue placeholder="No status set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No status</SelectItem>
                {serviceStatuses.map(s => (
                  <ServiceStatusSelectItem key={s.id} status={s} />
                ))}
                <ManageOptionsLink href="/settings/service-statuses" label="Manage service statuses" />
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
