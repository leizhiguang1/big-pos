'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { TableActionButton } from '@/components/ui/table-actions'
import { ArrowLeft, PencilLine, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { PERMISSION_GROUPS, PERMISSION_REQUIRES, type Permission } from '@/domain/permissions'
import { createRole, updateRole, deleteRole } from '@/lib/auth/role-actions'
import type { Role } from '@/lib/database.types'

// Flat list of every assignable permission key — used by the select-all toggle.
const ALL_PERMISSION_KEYS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key))

type RoleRow = Role & { perms: Set<string>; userCount: number }
type DialogState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; role: RoleRow }

export default function RolesManager() {
  const [rows, setRows] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })

  const load = async () => {
    const { data: roles } = await supabase
      .from('roles')
      .select('*, role_permissions(permission)')
      .order('is_system', { ascending: false })
      .order('name')
    const { data: profiles } = await supabase.from('profiles').select('role_id')
    const counts = new Map<string, number>()
    for (const p of profiles ?? []) {
      if (p.role_id) counts.set(p.role_id, (counts.get(p.role_id) ?? 0) + 1)
    }
    const mapped: RoleRow[] = ((roles as (Role & { role_permissions: { permission: string }[] })[]) ?? []).map(r => ({
      ...r,
      perms: new Set(r.role_permissions.map(rp => rp.permission)),
      userCount: counts.get(r.id) ?? 0,
    }))
    setRows(mapped)
    setLoading(false)
  }

  // `load` fetches asynchronously; its setState calls run after the await (post-
  // fetch), not synchronously during the effect, so they don't cause the cascading
  // re-render this rule guards against.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const remove = async (role: RoleRow) => {
    if (!confirm(`Delete the “${role.name}” role?`)) return
    const res = await deleteRole({ id: role.id })
    if (!res.ok) { alert((res as { error: string }).error); return }
    await load()
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">Roles &amp; Permissions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Create roles and choose what each one can do.</p>
          </div>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4 mr-2" />New role</Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {loading && <p className="text-center py-8 text-muted-foreground">Loading…</p>}
          {!loading && rows.map(role => (
            <div key={role.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{role.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {role.is_system ? 'All permissions' : `${role.perms.size} permission${role.perms.size === 1 ? '' : 's'}`}
                  {' · '}{role.userCount} {role.userCount === 1 ? 'person' : 'people'}
                </p>
              </div>
              {!role.is_system && (
                <div className="flex gap-2 self-end sm:self-auto">
                  <TableActionButton label="Edit role" icon={PencilLine} tone="primary" onClick={() => setDialog({ mode: 'edit', role })} />
                  <TableActionButton label="Delete role" icon={Trash2} tone="danger" disabled={role.userCount > 0} onClick={() => remove(role)} />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {dialog.mode !== 'closed' && (
        <RoleDialog
          key={dialog.mode === 'create' ? 'create' : dialog.role.id}
          state={dialog}
          onClose={() => setDialog({ mode: 'closed' })}
          onSaved={async () => { setDialog({ mode: 'closed' }); await load() }}
        />
      )}
    </div>
  )
}

function RoleDialog({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<DialogState, { mode: 'closed' }>
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const role = state.mode === 'edit' ? state.role : null
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  // Keep only permissions still in the catalogue — guards against a role that
  // holds a retired permission (e.g. legacy services.*) re-submitting it.
  const [perms, setPerms] = useState<Set<string>>(
    new Set([...(role?.perms ?? [])].filter(p => (ALL_PERMISSION_KEYS as string[]).includes(p))),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // edit/manage imply their view; removing a view clears its dependents — so a
  // role can never end up able to edit a section it cannot open.
  const grant = (set: Set<string>, key: Permission) => {
    set.add(key)
    const req = PERMISSION_REQUIRES[key]
    if (req) set.add(req)
  }
  const revoke = (set: Set<string>, key: Permission) => {
    set.delete(key)
    for (const [dependent, req] of Object.entries(PERMISSION_REQUIRES)) {
      if (req === key) set.delete(dependent)
    }
  }

  const toggle = (key: Permission) => {
    setPerms(prev => {
      const next = new Set(prev)
      if (next.has(key)) revoke(next, key); else grant(next, key)
      return next
    })
  }

  const allSelected = perms.size === ALL_PERMISSION_KEYS.length
  const setAll = (on: boolean) => setPerms(on ? new Set(ALL_PERMISSION_KEYS) : new Set())
  const setGroup = (keys: Permission[], on: boolean) => {
    setPerms(prev => {
      const next = new Set(prev)
      for (const k of keys) { if (on) grant(next, k); else revoke(next, k) }
      return next
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const permissions = [...perms]
    try {
      const res = state.mode === 'create'
        ? await createRole({ name, description, permissions })
        : await updateRole({ id: state.role.id, name, description, permissions })
      if (res.ok) await onSaved()
      else setError((res as { error: string }).error)
    } catch (err) {
      // A thrown server action (env/auth/network failure) would otherwise leave
      // the button stuck on "Saving…" with no explanation. Surface it instead.
      setError(err instanceof Error ? err.message : 'Could not save the role. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{state.mode === 'create' ? 'New role' : 'Edit role'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Role name *</Label>
            <Input placeholder="e.g. Operations" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input placeholder="Optional" value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <Label>Permissions</Label>
              <button
                type="button"
                onClick={() => setAll(!allSelected)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            {PERMISSION_GROUPS.map(group => {
              const keys = group.permissions.map(p => p.key)
              const groupSelected = keys.every(k => perms.has(k))
              return (
                <div key={group.label}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                    <button
                      type="button"
                      onClick={() => setGroup(keys, !groupSelected)}
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      {groupSelected ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {group.permissions.map(p => (
                      <label key={p.key} className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
                        <Checkbox className="mt-0.5" checked={perms.has(p.key)} onCheckedChange={() => toggle(p.key)} />
                        <span>
                          {p.label}
                          {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save role'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
