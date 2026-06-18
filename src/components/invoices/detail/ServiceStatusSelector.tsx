'use client'

// Service Status card (what the lab tells the doctor — Try in / Redo / …).
// Renders for any non-void invoice (matching the original, which did not gate
// the dropdown by canEdit). Writes via updateServiceStatusAction, which enforces
// canEditInvoice semantics server-side.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { updateServiceStatusAction } from '@/data/invoice-actions'
import { DEFAULT_COLOR } from '@/lib/service-status'
import type { ServiceStatus } from '@/lib/database.types'

export type ServiceStatusSelectorProps = {
  invoiceId: string
  serviceStatusId: string | null
  serviceStatuses: ServiceStatus[]
}

export function ServiceStatusSelector({ invoiceId, serviceStatusId: initial, serviceStatuses }: ServiceStatusSelectorProps) {
  const router = useRouter()
  const { show } = useToast()
  const [serviceStatusId, setServiceStatusId] = useState<string | null>(initial)

  const currentServiceStatus = serviceStatuses.find(s => s.id === serviceStatusId)

  const update = async (nextId: string | null) => {
    const prev = serviceStatusId
    setServiceStatusId(nextId)
    const res = await updateServiceStatusAction(invoiceId, nextId)
    if (res.ok === false) { setServiceStatusId(prev); show({ variant: 'error', title: res.error }); return }
    show({ variant: 'success', title: 'Service status updated' })
    router.refresh()
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Service Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={serviceStatusId ?? '__none__'}
              onValueChange={v => update(v === '__none__' ? null : v)}
            >
              <SelectTrigger
                className={cn(
                  'h-9 w-56 text-sm font-medium',
                  currentServiceStatus ? cn('border-transparent', currentServiceStatus.color ?? DEFAULT_COLOR) : '',
                )}
              >
                <SelectValue placeholder="No status set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No status</SelectItem>
                {serviceStatuses.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {serviceStatuses.length === 0 && (
              <p className="text-xs text-gray-500">
                No statuses configured.{' '}
                <Link href="/settings/service-statuses" className="text-primary hover:underline">
                  Add some in Settings
                </Link>.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
