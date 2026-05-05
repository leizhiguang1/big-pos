'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'

const schema = z.object({
  clinic_name: z.string().min(1, 'Clinic name is required'),
  ssm_no: z.string().optional(),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  billing_address: z.string().optional(),
  delivery_address: z.string().optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export default function CustomerForm({ customerId }: { customerId?: string }) {
  const router = useRouter()
  const isEdit = Boolean(customerId)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (isEdit && customerId) {
      supabase.from('customers').select('*').eq('id', customerId).single().then(({ data }) => {
        if (data) reset(data)
      })
    }
  }, [customerId, isEdit, reset])

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    setServerError('')
    const payload = {
      clinic_name: data.clinic_name,
      ssm_no: data.ssm_no || null,
      contact_person: data.contact_person || null,
      phone: data.phone || null,
      email: data.email || null,
      billing_address: data.billing_address || null,
      delivery_address: data.delivery_address || null,
      notes: data.notes || null,
    }

    const { error } = isEdit
      ? await supabase.from('customers').update(payload).eq('id', customerId!)
      : await supabase.from('customers').insert(payload)

    if (error) {
      setServerError(error.message)
      setSaving(false)
    } else {
      router.push('/customers')
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Customer' : 'New Customer'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Dental clinic or dentist details</p>
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

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
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
