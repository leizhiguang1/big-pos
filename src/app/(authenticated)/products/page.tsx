import { getProductsPage, getActiveUnits, type ProductView } from '@/data/products'
import { parseListSearchParams } from '@/lib/list-url-state'
import { ProductsClient } from '@/components/products/ProductsClient'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const state = parseListSearchParams(sp, 'active')
  const view = (['active', 'inactive', 'all'].includes(state.view) ? state.view : 'active') as ProductView

  const [page, units] = await Promise.all([
    getProductsPage({ q: state.q, view, page: state.page, sort: state.sort, dir: state.dir }),
    getActiveUnits(),
  ])

  return <ProductsClient page={page} units={units} state={state} />
}
