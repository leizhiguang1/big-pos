'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/feedback/toast'
import { customerInputSchema, type CustomerInput } from '@/domain/schemas'
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

  const { register, handleSubmit, formState: { errors } } = useForm<CustomerInput>({
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

  const onSubmit = async (data: CustomerInput) => {
    if (!canEdit) return
    setSaving(true)

    const result = isEdit
      ? await updateCustomerAction(initialData!.id, data)
      : await createCustomerAction(data)

    if (result.ok === false) {
      show({ variant: 'error', title: result.error })
      setSaving(false)
      return
    }
    show({ variant: 'success', title: isEdit ? 'Customer updated' : 'Customer created' })
    router.push('/customers')
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isEdit ? 'Edit Customer' : 'New Customer'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Dental clinic or dentist details</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Customer Information</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
              <Label htmlFor="contact_person">Contact Person (Dr. Name)</Label>
              <Input id="contact_person" placeholder="e.g. Dr. Ahmad bin Ali" {...register('contact_person')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" placeholder="e.g. 012-3456789" {...register('phone')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="clinic@example.com" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billing_address">Billing Address</Label>
                <Textarea
                  id="billing_address"
                  placeholder="Address for invoice billing…"
                  rows={4}
                  {...register('billing_address')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery_address">Delivery Address</Label>
                <Textarea
                  id="delivery_address"
                  placeholder="Address for lab work delivery…"
                  rows={4}
                  {...register('delivery_address')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Any additional notes…" rows={2} {...register('notes')} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving || !canEdit}>
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
