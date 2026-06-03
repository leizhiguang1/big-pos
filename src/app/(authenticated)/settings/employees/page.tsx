import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/require-admin'
import EmployeesManager from '@/components/employees/EmployeesManager'

// Admin-only. Enforced server-side so non-admins can't reach the page even if the
// nav item were exposed; the client component below only handles interactivity.
export default async function EmployeesPage() {
  const gate = await requireAdmin()
  if (!gate.ok) redirect('/dashboard')

  return <EmployeesManager currentUserId={gate.userId} />
}
