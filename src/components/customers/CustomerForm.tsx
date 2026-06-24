'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { customerInputSchema, type CustomerInput, type CustomerFormInput } from '@/domain/schemas'
import { createCustomerAction, updateCustomerAction } from '@/data/customer-actions'
import type { Customer } from '@/lib/database.types'

// Create/edit form for a customer. Edit-mode prefill arrives as `initialData`
// from the Server Component (`getCustomerForEdit`) — no browser-singleton read.
// Submits go through the permission-gated Server Actions; success/failure surface
// via the global toast.
export default function CustomerForm({ initialData }: { initialData?: Customer }) {
  const router = useRouter()
  const { hasPermission, loading } = useAuth()
  const { show } = useToast()
  const canEdit = hasPermission('customers.edit')
  const isEdit = Boolean(initialData)
  const [saving, setSaving] = useState(false)

  const { register, control, handleSubmit, formState: { errors } } = useForm<CustomerFormInput>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: {
      clinic_name: initialData?.clinic_name ?? '',
      ssm_no: initialData?.ssm_no ?? '',
      contact_person: initialData?.contact_person ?? '',
      phone: initialData?.phone ?? '',
      email: initialData?.email ?? '',
      billing_address: initialData?.billing_address ?? '',
      delivery_address: initialData?.delivery_address ?? '',
      notes: initialData?.notes ?? '',
    },
  })

  // Deep-link guard: reaching /customers/new or /customers/[id]/edit without the
  // edit permission bounces back to the list once the role has loaded. The real
  // gate is each Server Action's `requirePermission('customers.edit')`.
  useEffect(() => {
    if (!loading && !canEdit) router.replace('/customers')
  }, [loading, canEdit, router])

  const onSubmit = async (data: CustomerFormInput) => {
    if (!canEdit) return
    setSaving(true)

    // The zod resolver has already applied the `.default()` values, so the parsed
    // payload satisfies CustomerInput (the action re-validates with safeParse too).
    const parsed = data as CustomerInput
    const result = isEdit
      ? await updateCustomerAction(initialData!.id, parsed)
      : await createCustomerAction(parsed)

    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      setSaving(false)
      return
    }
    show({ variant: 'success', title: isEdit ? 'Clinic updated' : 'Clinic created' })
    router.push('/customers')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto w-full max-w-2xl pb-12">
      {/* Sticky header: labeled back link + primary actions always in reach. */}
      <div className="sticky top-0 z-10 border-b border-border bg-background py-4">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Clinics
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{isEdit ? 'Edit Clinic' : 'New Clinic'}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Dental clinic or dentist details</p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" disabled={saving || !canEdit}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Clinic'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="clinic_name">Clinic / Business Name *</Label>
            <Input id="clinic_name" placeholder="e.g. Klinik Gigi Sehat" {...register('clinic_name')} />
            {errors.clinic_name && <p className="text-xs text-destructive">{errors.clinic_name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ssm_no">SSM No.</Label>
            <Input id="ssm_no" placeholder="e.g. 202301012345" {...register('ssm_no')} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact_person">Contact Person (Dr. Name) *</Label>
          <Input id="contact_person" placeholder="e.g. Dr. Ahmad bin Ali" {...register('contact_person')} />
          {errors.contact_person && <p className="text-xs text-destructive">{errors.contact_person.message}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneInput id="phone" value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" placeholder="clinic@example.com" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="billing_address">Billing Address *</Label>
            <Textarea
              id="billing_address"
              placeholder="Address for invoice billing…"
              rows={4}
              {...register('billing_address')}
            />
            {errors.billing_address && <p className="text-xs text-destructive">{errors.billing_address.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery_address">Delivery Address *</Label>
            <Textarea
              id="delivery_address"
              placeholder="Address for lab work delivery…"
              rows={4}
              {...register('delivery_address')}
            />
            {errors.delivery_address && <p className="text-xs text-destructive">{errors.delivery_address.message}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" placeholder="Any additional notes…" rows={3} {...register('notes')} />
        </div>
      </div>
    </form>
  )
}
