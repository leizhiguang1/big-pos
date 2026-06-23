import { getCustomersPage } from '@/data/customers'
import { parseListSearchParams } from '@/lib/list-url-state'
import { CustomerListClient } from '@/components/customers/CustomerListClient'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const state = parseListSearchParams(sp, '')
  const page = await getCustomersPage({ q: state.q, page: state.page, sort: state.sort, dir: state.dir })
  return <CustomerListClient page={page} state={state} />
}
