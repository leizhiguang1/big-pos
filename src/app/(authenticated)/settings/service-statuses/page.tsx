import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/require-permission'
import ServiceStatusesClient from './ServiceStatusesClient'

// Server gate in front of the client UI: without settings.manage the page (and
// its data) never renders — no flash, no client-only redirect. RLS on
// service_statuses is the backstop; this is defense-in-depth + clean UX.
export default async function ServiceStatusesPage() {
  const gate = await requirePermission('settings.manage')
  if (gate.ok === false) redirect('/dashboard')

  return <ServiceStatusesClient />
}
