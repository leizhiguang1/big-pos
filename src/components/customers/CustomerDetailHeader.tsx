'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Edit, Plus, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { ArchiveClinicControls } from '@/components/customers/ArchiveClinicControls'

// Interactive header for the customer detail page: browser-back, the
// permission-gated Edit button, and New Invoice. The customer name/contact are
// passed in from the Server Component so the data fetch stays server-side.
export function CustomerDetailHeader({
  id,
  clinicName,
  contactPerson,
  archivedAt,
}: {
  id: string
  clinicName: string
  contactPerson: string | null
  archivedAt: string | null
}) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const archived = archivedAt !== null

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{clinicName}</h1>
            {archived && <Badge variant="secondary" className="uppercase">Archived</Badge>}
          </div>
          {contactPerson && <p className="text-sm text-muted-foreground mt-0.5">{contactPerson}</p>}
        </div>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        {!archived && hasPermission('customers.edit') && (
          <Button className="w-full sm:w-auto" variant="outline" size="sm" asChild>
            <Link href={`/customers/${id}/edit`}><Edit className="h-4 w-4 mr-2" />Edit</Link>
          </Button>
        )}
        <Button className="w-full sm:w-auto" variant="outline" size="sm" asChild>
          <Link href={`/customers/${id}/statement`}><FileText className="h-4 w-4 mr-2" />Statement</Link>
        </Button>
        {!archived && hasPermission('invoices.create') && (
          <Button className="col-span-2 w-full sm:col-span-1 sm:w-auto" size="sm" asChild>
            <Link href={`/invoices/new?customer=${id}`}><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
          </Button>
        )}
        {hasPermission('customers.edit') && <ArchiveClinicControls id={id} archived={archived} />}
      </div>
    </div>
  )
}
