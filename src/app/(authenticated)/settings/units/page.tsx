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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ArrowLeft, Plus, Pencil, ToggleLeft, ToggleRight, ArrowUp, ArrowDown } from 'lucide-react'
import type { Unit } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'

const schema = z.object({
  label: z.string().min(1, 'Label is required').max(40, 'Keep it short'),
})
type FormData = z.infer<typeof schema>

export default function UnitsPage() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('settings.manage')
  const [rows, setRows] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Unit | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { label: '' },
  })

  const load = () =>
    supabase
      .from('units')
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
    reset({ label: '' })
    setOpen(true)
  }

  const openEdit = (u: Unit) => {
    setEditing(u)
    setError(null)
    reset({ label: u.label })
    setOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    let saveError: string | null = null
    if (editing) {
      const { error } = await supabase
        .from('units')
        .update({ label: data.label.trim() })
        .eq('id', editing.id)
      if (error) saveError = error.message
    } else {
      const nextOrder = (rows.at(-1)?.sort_order ?? 0) + 10
      const { error } = await supabase.from('units').insert({
        label: data.label.trim(),
        sort_order: nextOrder,
        is_active: true,
      })
      if (error) saveError = error.message
    }
    setSaving(false)
    if (saveError) {
      setError(saveError)
    } else {
      setOpen(false)
      load()
    }
  }

  const toggleActive = async (u: Unit) => {
    await supabase.from('units').update({ is_active: !u.is_active }).eq('id', u.id)
    load()
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = rows[index + dir]
    const current = rows[index]
    if (!target || !current) return
    await Promise.all([
      supabase.from('units').update({ sort_order: target.sort_order }).eq('id', current.id),
      supabase.from('units').update({ sort_order: current.sort_order }).eq('id', target.id),
    ])
    load()
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Units</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Units of measure for products (per tooth, per arch, per case…).</p>
          </div>
        </div>
        {canEdit && <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Unit</Button>}
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
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No units yet</TableCell></TableRow>}
              {rows.map((u, i) => (
                <TableRow key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Move up</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Move down</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{u.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.is_active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit unit" onClick={() => openEdit(u)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit unit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={u.is_active ? 'Deactivate unit' : 'Activate unit'} onClick={() => toggleActive(u)}>
                              {u.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{u.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
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
            <DialogTitle>{editing ? 'Edit Unit' : 'New Unit'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input placeholder="e.g. tooth" {...register('label')} />
              {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Unit'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
