'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperadmin } from '@/lib/auth/require-permission'
import { PERMISSIONS } from '@/domain/permissions'

export type ActionResult = { ok: true } | { ok: false; error: string }

const VALID = new Set<string>(Object.values(PERMISSIONS))

function cleanPermissions(input: string[]): string[] {
  return [...new Set(input.filter(p => VALID.has(p)))]
}

export async function createRole(input: {
  name: string
  description?: string
  permissions: string[]
}): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Role name is required.' }

  const admin = createAdminClient()
  const { data: role, error } = await admin
    .from('roles')
    .insert({ name, description: input.description?.trim() || null, is_system: false })
    .select('id')
    .single()
  if (error || !role) return { ok: false, error: error?.message ?? 'Could not create role.' }

  const perms = cleanPermissions(input.permissions)
  if (perms.length) {
    const { error: permErr } = await admin
      .from('role_permissions')
      .insert(perms.map(permission => ({ role_id: role.id, permission })))
    if (permErr) return { ok: false, error: permErr.message }
  }

  revalidatePath('/settings/roles')
  return { ok: true }
}

export async function updateRole(input: {
  id: string
  name: string
  description?: string
  permissions: string[]
}): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Role name is required.' }

  const admin = createAdminClient()

  // The built-in Super Admin role can't be edited (always all permissions).
  const { data: existing } = await admin.from('roles').select('is_system').eq('id', input.id).single()
  if (!existing) return { ok: false, error: 'Role not found.' }
  if (existing.is_system) return { ok: false, error: 'The Super Admin role cannot be edited.' }

  const { error: updErr } = await admin
    .from('roles')
    .update({ name, description: input.description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', input.id)
  if (updErr) return { ok: false, error: updErr.message }

  // Replace the permission set wholesale.
  const { error: delErr } = await admin.from('role_permissions').delete().eq('role_id', input.id)
  if (delErr) return { ok: false, error: delErr.message }

  const perms = cleanPermissions(input.permissions)
  if (perms.length) {
    const { error: insErr } = await admin
      .from('role_permissions')
      .insert(perms.map(permission => ({ role_id: input.id, permission })))
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath('/settings/roles')
  return { ok: true }
}

export async function deleteRole(input: { id: string }): Promise<ActionResult> {
  const gate = await requireSuperadmin()
  if (!gate.ok) return gate

  const admin = createAdminClient()

  const { data: existing } = await admin.from('roles').select('is_system').eq('id', input.id).single()
  if (!existing) return { ok: false, error: 'Role not found.' }
  if (existing.is_system) return { ok: false, error: 'The Super Admin role cannot be deleted.' }

  // Block deletion while users still hold this role.
  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', input.id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Reassign the employees on this role before deleting it.' }
  }

  const { error } = await admin.from('roles').delete().eq('id', input.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/roles')
  return { ok: true }
}
