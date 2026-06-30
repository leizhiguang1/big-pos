import { redirect } from 'next/navigation'
import { getCustomersPage } from '@/data/customers'
import { parseListSearchParams } from '@/lib/list-url-state'
import { requirePermission } from '@/lib/auth/require-permission'
import { CustomerListClient } from '@/components/customers/CustomerListClient'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const gate = await requirePermission('customers.view')
  if (gate.ok === false) redirect('/dashboard')

  const sp = await searchParams
  const state = parseListSearchParams(sp, '')
  const archived = sp.archived === '1'
  const page = await getCustomersPage({ q: state.q, page: state.page, sort: state.sort, dir: state.dir, archived })
  return <CustomerListClient page={page} state={state} archived={archived} />
}
