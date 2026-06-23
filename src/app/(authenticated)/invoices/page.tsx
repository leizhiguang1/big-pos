import { getInvoicesPage, getInvoiceViewCounts, type InvoiceView } from '@/data/invoices'
import { parseListSearchParams } from '@/lib/list-url-state'
import { InvoiceListClient } from '@/components/invoices/InvoiceListClient'

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const state = parseListSearchParams(sp, 'all')
  const view = state.view as InvoiceView

  const [pageData, counts] = await Promise.all([
    getInvoicesPage({ q: state.q, view, page: state.page, sort: state.sort, dir: state.dir }),
    getInvoiceViewCounts(),
  ])

  return <InvoiceListClient page={pageData} counts={counts} state={state} />
}
