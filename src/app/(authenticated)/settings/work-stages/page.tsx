import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/require-permission'
import WorkStagesClient from './WorkStagesClient'

// Server gate in front of the client UI — see service-statuses/page.tsx.
export default async function WorkStagesPage() {
  const gate = await requirePermission('settings.manage')
  if (gate.ok === false) redirect('/dashboard')

  return <WorkStagesClient />
}
