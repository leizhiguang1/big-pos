import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/require-permission'
import EmployeesManager from '@/components/employees/EmployeesManager'

// manageEmployees only. Enforced server-side so non-holders can't reach the page
// even if the nav item were exposed.
export default async function EmployeesPage() {
  const gate = await requirePermission('manageEmployees')
  if (!gate.ok) redirect('/dashboard')

  return <EmployeesManager currentUserId={gate.userId} />
}
