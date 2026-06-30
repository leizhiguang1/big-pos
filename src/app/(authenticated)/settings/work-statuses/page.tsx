import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/require-permission'
import WorkStatusesClient from './WorkStatusesClient'

// Server gate in front of the client UI — see service-statuses/page.tsx.
export default async function WorkStatusesPage() {
  const gate = await requirePermission('settings.manage')
  if (gate.ok === false) redirect('/dashboard')

  return <WorkStatusesClient />
}
