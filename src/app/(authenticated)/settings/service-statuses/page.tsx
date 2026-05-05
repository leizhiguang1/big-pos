'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Plus, Pencil, ToggleLeft, ToggleRight, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ServiceStatus } from '@/lib/database.types'
import { COLOR_PRESETS, DEFAULT_COLOR } from '@/lib/service-status'

const schema = z.object({
  label: z.string().min(1, 'Label is required').max(40, 'Keep it short'),
  color: z.string().min(1),
})
type FormData = z.infer<typeof schema>

export default function ServiceStatusesPage() {
  const [rows, setRows] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { label: '', color: DEFAULT_COLOR },
  })
  const watchedColor = watch('color')
  const watchedLabel = watch('label')

  const load = () =>
    supabase
      .from('service_statuses')
      .select('*')
      .order('sort_order')
      .order('label')
      .then(({ data }) => {
        setRows(data ?? [])
        setLoading(false)
      })

  useEffect(() => { load() }, [])

  const openNew = () => {
    setEditing(null)
    setError(null)
    reset({ label: '', color: DEFAULT_COLOR })
    setOpen(true)
  }

  const openEdit = (s: ServiceStatus) => {
    setEditing(s)
    setError(null)
    reset({ label: s.label, color: s.color ?? DEFAULT_COLOR })
    setOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    setError(null)
    if (editing) {
      const { error } = await supabase
        .from('service_statuses')
        .update({ label: data.label.trim(), color: data.color })
        .eq('id', editing.id)
      if (error) setError(error.message)
    } else {
      const nextOrder = (rows.at(-1)?.sort_order ?? 0) + 10
      const { error } = await supabase.from('service_statuses').insert({
        label: data.label.trim(),
        color: data.color,
        sort_order: nextOrder,
        is_active: true,
      })
      if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) {
      setOpen(false)
      load()
    }
  }

  const toggleActive = async (s: ServiceStatus) => {
    await supabase.from('service_statuses').update({ is_active: !s.is_active }).eq('id', s.id)
    load()
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = rows[index + dir]
    const current = rows[index]
    if (!target || !current) return
    await Promise.all([
      supabase.from('service_statuses').update({ sort_order: target.sort_order }).eq('id', current.id),
      supabase.from('service_statuses').update({ sort_order: current.sort_order }).eq('id', target.id),
    ])
    load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Service Statuses</h1>
            <p className="text-sm text-gray-500 mt-0.5">Lab-to-doctor instruction printed on delivery notes.</p>
          </div>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Status</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Order</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">No statuses yet</TableCell></TableRow>}
              {rows.map((s, i) => (
                <TableRow key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', s.color ?? DEFAULT_COLOR)}>
                      {s.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">{s.is_active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActive(s)}>
                        {s.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Service Status' : 'New Service Status'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input placeholder="e.g. Try in" {...register('label')} />
              {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="grid grid-cols-4 gap-2">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setValue('color', c.value, { shouldDirty: true })}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs font-medium border-2 transition-colors',
                      c.value,
                      watchedColor === c.value ? 'border-gray-900' : 'border-transparent hover:border-gray-300',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="pt-2">
                <p className="text-xs text-gray-500 mb-1.5">Preview</p>
                <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', watchedColor)}>
                  {watchedLabel || 'Status'}
                </span>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Status'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
