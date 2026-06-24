'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ActiveSwitch, TableActionButton } from '@/components/ui/table-actions'
import { ArrowLeft, KeyRound, PencilLine, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Profile, Role } from '@/lib/database.types'
import { createEmployee, updateEmployee, resetPin, setActive, deleteEmployee } from '@/lib/auth/employee-actions'
import { selectableRoles } from './role-filter'

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; employee: Profile }
  | { mode: 'resetPin'; employee: Profile }

export default function EmployeesManager({ currentUserId }: { currentUserId: string }) {
  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [roles, setRoles] = useState<Role[]>([])

  const load = () =>
    supabase
      .from('profiles')
      .select('*, roles(id, name, is_system)')
      .order('full_name')
      .then(({ data }) => {
        setRows((data as Profile[]) ?? [])
        setLoading(false)
      })

  useEffect(() => {
    load()
    supabase.from('roles').select('*').order('name').then(({ data }) => setRoles((data as Role[]) ?? []))
  }, [])

  const toggleActive = (p: Profile) => {
    if (p.id === currentUserId) return
    if (p.active && !confirm(`Deactivate ${p.full_name}? They will no longer be able to sign in.`)) return
    setBusyId(p.id)
    startTransition(async () => {
      try {
        await setActive({ id: p.id, active: !p.active })
        await load()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not update the employee. Please try again.')
      } finally {
        setBusyId(null)
      }
    })
  }

  const remove = (p: Profile) => {
    if (p.id === currentUserId) return
    if (!confirm(`Permanently delete ${p.full_name}? This removes their login and cannot be undone.`)) return
    setBusyId(p.id)
    startTransition(async () => {
      try {
        const res = await deleteEmployee({ id: p.id })
        await load()
        if (!res.ok && 'error' in res) alert(res.error)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not delete the employee. Please try again.')
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="w-full max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/settings">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>Back to Settings</TooltipContent>
          </Tooltip>
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">Employees</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Add staff logins, reset PINs, and manage access.</p>
          </div>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4 mr-2" />Add Employee</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No employees yet</TableCell></TableRow>}
              {rows.map(p => (
                <TableRow key={p.id} className={p.active ? '' : 'opacity-60'}>
                  <TableCell className="font-medium text-foreground">
                    {p.full_name}
                    {p.id === currentUserId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.username}</TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      p.roles?.is_system ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-muted-foreground',
                    )}>
                      {p.roles?.name ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-muted-foreground',
                    )}>
                      {p.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <TableActionButton label="Edit name and role" icon={PencilLine} tone="primary" onClick={() => setDialog({ mode: 'edit', employee: p })} />
                      <TableActionButton label="Reset PIN" icon={KeyRound} onClick={() => setDialog({ mode: 'resetPin', employee: p })} />
                      <ActiveSwitch
                        checked={p.active}
                        onCheckedChange={() => toggleActive(p)}
                        disabled={p.id === currentUserId || busyId === p.id}
                        activeLabel="Can sign in"
                        inactiveLabel="Blocked"
                        tooltip={p.id === currentUserId ? 'You cannot deactivate yourself' : p.active ? 'Block sign-in' : 'Allow sign-in'}
                      />
                      <TableActionButton
                        label={p.id === currentUserId ? 'You cannot delete yourself' : 'Delete permanently'}
                        icon={Trash2}
                        tone="danger"
                        disabled={p.id === currentUserId || busyId === p.id}
                        onClick={() => remove(p)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog.mode !== 'closed' && (
        <EmployeeDialog
          key={dialog.mode === 'create' ? 'create' : `${dialog.mode}:${dialog.employee.id}`}
          state={dialog}
          roles={roles}
          onClose={() => setDialog({ mode: 'closed' })}
          onSaved={async () => { setDialog({ mode: 'closed' }); await load() }}
        />
      )}
    </div>
    </TooltipProvider>
  )
}

function EmployeeDialog({
  state,
  roles,
  onClose,
  onSaved,
}: {
  state: Exclude<DialogState, { mode: 'closed' }>
  roles: Role[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const employee = 'employee' in state ? state.employee : null
  const [username, setUsername] = useState(employee?.username ?? '')
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [pin, setPin] = useState('')
  const [roleId, setRoleId] = useState<string>(employee?.role_id ?? roles[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = state.mode === 'create' ? 'Add Employee' : state.mode === 'edit' ? 'Edit Employee' : 'Reset PIN'
  const onPin = (v: string) => setPin(v.replace(/\D/g, '').slice(0, 6))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      let res
      if (state.mode === 'create') {
        res = await createEmployee({ username, pin, fullName, roleId })
      } else if (state.mode === 'edit') {
        res = await updateEmployee({ id: state.employee.id, fullName, roleId })
      } else {
        res = await resetPin({ id: state.employee.id, pin })
      }

      if (res.ok) {
        await onSaved()
      } else {
        setError(res.error)
      }
    } catch (err) {
      // A thrown server action would otherwise leave the button stuck on
      // "Saving…" with no explanation. Surface it instead.
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {state.mode === 'resetPin' && (
            <DialogDescription>Set a new 6-digit PIN for {state.employee.full_name}.</DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {state.mode === 'create' && (
            <div className="space-y-2">
              <Label>User ID *</Label>
              <Input
                placeholder="e.g. jiaying"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">3–30 letters, numbers, dot, dash or underscore. Used to sign in.</p>
            </div>
          )}

          {state.mode === 'edit' && (
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input value={state.employee.username} disabled />
            </div>
          )}

          {(state.mode === 'create' || state.mode === 'edit') && (
            <>
              <div className="space-y-2">
                <Label>Full name {state.mode === 'create' ? '' : '*'}</Label>
                <Input
                  placeholder="e.g. Tan Jia Ying"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Role *</Label>
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                  <SelectContent>
                    {selectableRoles(roles, roleId).map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Each role grants a set of permissions. Manage roles in Settings → Roles.</p>
              </div>
            </>
          )}

          {(state.mode === 'create' || state.mode === 'resetPin') && (
            <div className="space-y-2">
              <Label>{state.mode === 'create' ? 'PIN (6 digits) *' : 'New PIN (6 digits) *'}</Label>
              <Input
                type="password"
                inputMode="numeric"
                placeholder="••••••"
                maxLength={6}
                value={pin}
                onChange={e => onPin(e.target.value)}
                autoComplete="new-password"
                autoFocus={state.mode === 'resetPin'}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : state.mode === 'create' ? 'Add Employee' : state.mode === 'edit' ? 'Save Changes' : 'Set PIN'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
