'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Edit, Plus, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// Interactive header for the customer detail page: browser-back, the
// permission-gated Edit button, and New Invoice. The customer name/contact are
// passed in from the Server Component so the data fetch stays server-side.
export function CustomerDetailHeader({
  id,
  clinicName,
  contactPerson,
}: {
  id: string
  clinicName: string
  contactPerson: string | null
}) {
  const router = useRouter()
  const { hasPermission } = useAuth()

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{clinicName}</h1>
          {contactPerson && <p className="text-sm text-muted-foreground mt-0.5">{contactPerson}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        {hasPermission('customers.edit') && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/customers/${id}/edit`}><Edit className="h-4 w-4 mr-2" />Edit</Link>
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href={`/customers/${id}/statement`}><FileText className="h-4 w-4 mr-2" />Statement</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href={`/invoices/new?customer=${id}`}><Plus className="h-4 w-4 mr-2" />New Invoice</Link>
        </Button>
      </div>
    </div>
  )
}
