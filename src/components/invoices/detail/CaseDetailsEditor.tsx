'use client'

// Patient / Doctor card. Editable only when `canEdit` (canEditInvoice + !voided,
// decided server-side and passed down). On blur, if either field changed, calls
// updateCaseDetailsAction and refreshes the server data.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { canEditInvoice } from '@/lib/invoice-permissions'
import { updateCaseDetailsAction } from '@/data/invoice-actions'
import type { InvoiceDetail } from '@/data/invoices'

export type CaseDetailsEditorProps = {
  invoice: Pick<InvoiceDetail, 'id' | 'status' | 'voided_at' | 'patient' | 'doctor'>
}

export function CaseDetailsEditor({ invoice }: CaseDetailsEditorProps) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const { show } = useToast()
  const invoiceId = invoice.id
  const patientProp = invoice.patient
  const doctorProp = invoice.doctor
  const [patient, setPatient] = useState(patientProp ?? '')
  const [doctor, setDoctor] = useState(doctorProp ?? '')
  // Inputs are editable only when content-edit gating allows it (matches the
  // original page's `canEdit = canEditInvoice(invoice, hasPermission)`).
  const canEdit = canEditInvoice(invoice, hasPermission)

  const save = async () => {
    const next = { patient: patient || null, doctor: doctor || null }
    if (next.patient === (patientProp ?? null) && next.doctor === (doctorProp ?? null)) return
    const res = await updateCaseDetailsAction(invoiceId, next)
    if (res.ok === false) { show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Case details updated' })
    router.refresh()
  }

  return (
    <Card className="print:hidden">
      <CardHeader><CardTitle className="text-base">Case Details</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
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
              <p className="py-2 text-sm text-gray-900">{patient || '—'}</p>
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
              <p className="py-2 text-sm text-gray-900">{doctor || '—'}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
