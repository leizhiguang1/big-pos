'use client'

import { useState } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DataTable } from '@/components/ui/data-table'
import type { Column } from '@/lib/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { listViewState } from '@/lib/list-view-state'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { usePaginatedList } from '@/lib/use-paginated-list'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { Pagination } from '@/components/ui/pagination'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { buildUnitOptions } from '@/lib/units'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, ToggleLeft, ToggleRight, Package } from 'lucide-react'
import type { Product, Unit } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import type { ProductInput } from '@/domain/schemas'
import { createProductAction, updateProductAction, toggleProductActiveAction } from '@/data/product-actions'

// Stable identity (module-level) so the hook's memoized filter is stable.
function productMatchesQuery(p: Product, query: string): boolean {
  const q = query.toLowerCase()
  return (
    p.name.toLowerCase().includes(q) ||
    (p.description?.toLowerCase().includes(q) ?? false) ||
    p.unit.toLowerCase().includes(q)
  )
}

// Client island for the products catalogue. The Server Component
// (`products/page.tsx`) fetches the rows via `getProducts` and passes them in;
// this component owns the create/edit dialog and the price-range toggle, and
// writes through the permission-gated Server Actions (which revalidate the list).
//
// The form schema (with the `use_price_range` UI toggle + numeric coercion) is
// client-only; the action re-validates a clean payload with `productInputSchema`.
const optionalPrice = z.preprocess(
  v => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().min(0, 'Must be 0 or more').optional(),
)

const schema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    use_price_range: z.boolean(),
    unit_price: optionalPrice,
    min_unit_price: optionalPrice,
    max_unit_price: optionalPrice,
    unit: z.string().min(1, 'Unit is required'),
  })
  .superRefine((data, ctx) => {
    if (data.use_price_range) {
      if (data.min_unit_price === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['min_unit_price'], message: 'Required' })
      }
      if (data.max_unit_price === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['max_unit_price'], message: 'Required' })
      }
      if (
        data.min_unit_price !== undefined &&
        data.max_unit_price !== undefined &&
        data.min_unit_price > data.max_unit_price
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['max_unit_price'], message: 'Max must be ≥ min' })
      }
    } else if (data.unit_price === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unit_price'], message: 'Price is required' })
    }
  })
type FormData = z.infer<typeof schema>

export function ProductsClient({ products, units }: { products: Product[]; units: Unit[] }) {
  const { hasPermission } = useAuth()
  const { show } = useToast()
  const canEdit = hasPermission('products.edit')
  const unitLabels = units.map(u => u.label)
  const defaultUnit = unitLabels.includes('unit') ? 'unit' : (unitLabels[0] ?? 'unit')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<FormData>({
    // zod's `coerce.number()` types the resolver input as `unknown`; cast to the
    // form's value type so RHF's Resolver generics line up.
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { unit: defaultUnit, unit_price: 0, use_price_range: false },
  })
  const usePriceRange = useWatch({ control, name: 'use_price_range' })

  const {
    query,
    setQuery,
    page,
    setPage,
    pageItems,
    filteredCount,
    totalPages,
    pageStart,
    pageEnd,
  } = usePaginatedList(products, { searchFn: productMatchesQuery, pageSize: 10 })

  const openNew = () => {
    setEditing(null)
    reset({
      name: '',
      description: '',
      use_price_range: false,
      unit_price: 0,
      min_unit_price: undefined,
      max_unit_price: undefined,
      unit: defaultUnit,
    })
    setOpen(true)
  }

  const openEdit = (p: Product) => {
    const hasRange = p.min_unit_price != null && p.max_unit_price != null
    setEditing(p)
    reset({
      name: p.name,
      description: p.description ?? '',
      use_price_range: hasRange,
      unit_price: hasRange ? undefined : p.unit_price,
      min_unit_price: p.min_unit_price ?? undefined,
      max_unit_price: p.max_unit_price ?? undefined,
      unit: p.unit,
    })
    setOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    if (!canEdit) return
    setSaving(true)
    const rangeMode = data.use_price_range
    const payload: ProductInput = {
      name: data.name,
      description: data.description || null,
      unit_price: rangeMode ? (data.min_unit_price as number) : (data.unit_price as number),
      unit: data.unit,
      min_unit_price: rangeMode ? (data.min_unit_price as number) : null,
      max_unit_price: rangeMode ? (data.max_unit_price as number) : null,
    }

    const result = editing
      ? await updateProductAction(editing.id, payload)
      : await createProductAction(payload)

    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      setSaving(false)
      return
    }
    show({ variant: 'success', title: editing ? 'Product updated' : 'Product added' })
    setSaving(false)
    setOpen(false)
  }

  const toggleActive = async (p: Product) => {
    const result = await toggleProductActiveAction(p.id, !p.active)
    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      return
    }
    show({ variant: 'success', title: p.active ? 'Product deactivated' : 'Product activated' })
  }

  const columns: Column<Product>[] = [
    { key: 'name', header: 'Name', cell: p => <span className="font-medium">{p.name}</span> },
    { key: 'description', header: 'Description', cell: p => <span className="text-sm text-muted-foreground">{p.description ?? '—'}</span> },
    { key: 'unit', header: 'Unit', cell: p => <span className="text-sm text-muted-foreground">per {p.unit}</span> },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      cell: p => (
        <span className="font-medium tabular-nums">
          {p.min_unit_price != null && p.max_unit_price != null
            ? `${formatCurrency(p.min_unit_price)} – ${formatCurrency(p.max_unit_price)}`
            : formatCurrency(p.unit_price)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: p => <Badge variant={p.active ? 'success' : 'secondary'}>{p.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 'w-24',
      cell: p =>
        canEdit ? (
          <div className="flex justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit product" onClick={() => openEdit(p)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit product</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={p.active ? 'Deactivate product' : 'Activate product'}
                  onClick={() => toggleActive(p)}
                >
                  {p.active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {p.active ? 'Active — click to deactivate (hides from new invoices)' : 'Inactive — click to activate'}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null,
    },
  ]

  const view = listViewState({
    loading: false,
    total: products.length,
    filtered: filteredCount,
    hasQuery: query.trim().length > 0,
  })

  const emptyState = (
    <EmptyState
      icon={<Package className="h-8 w-8" />}
      title={view === 'empty-no-results' ? 'No products match your search' : 'No products yet'}
      description={view === 'empty-no-results' ? 'Try a different search term.' : 'Add your first product to start invoicing.'}
    />
  )

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products & Services</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Price catalog for invoicing</p>
        </div>
        {canEdit && <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Product</Button>}
      </div>

      <ListToolbar value={query} onChange={setQuery} placeholder="Search products…" />

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={pageItems}
            rowKey={p => p.id}
            rowClassName={p => (p.active ? '' : 'opacity-50')}
            empty={emptyState}
            footer={
              <Pagination
                page={page}
                totalPages={totalPages}
                filteredCount={filteredCount}
                pageStart={pageStart}
                pageEnd={pageEnd}
                onPageChange={setPage}
                itemLabel="products"
              />
            }
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Product' : 'New Product / Service'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input placeholder="e.g. Zirconia Crown" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Short description…" rows={2} {...register('description')} />
            </div>
            {!usePriceRange ? (
              <div className="space-y-2">
                <Label>Price (MYR) *</Label>
                <Input type="number" step="0.01" min="0" {...register('unit_price')} />
                {errors.unit_price && <p className="text-xs text-destructive">{errors.unit_price.message}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min price (MYR) *</Label>
                  <Input type="number" step="0.01" min="0" {...register('min_unit_price')} />
                  {errors.min_unit_price && <p className="text-xs text-destructive">{errors.min_unit_price.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Max price (MYR) *</Label>
                  <Input type="number" step="0.01" min="0" {...register('max_unit_price')} />
                  {errors.max_unit_price && <p className="text-xs text-destructive">{errors.max_unit_price.message}</p>}
                </div>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 mt-0.5 rounded border-gray-300"
                {...register('use_price_range')}
              />
              <span>
                Enable price range
                <span className="block text-xs text-muted-foreground font-normal">Lets invoices use any price between a min and a max for this product.</span>
              </span>
            </label>
            <div className="space-y-2">
              <Label>Unit *</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">per</span>
                <div className="flex-1">
                  <Controller
                    control={control}
                    name="unit"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {buildUnitOptions(unitLabels, field.value).map(u => (
                            <SelectItem key={u} value={u}>
                              {unitLabels.includes(u) ? u : `${u} (inactive)`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
