'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth/require-permission'
import { usernameToEmail, USERNAME_PATTERN } from '@/lib/auth/username'
import { wouldRemoveLastSuperadmin } from '@/domain/permissions'

export type ActionResult = { ok: true } | { ok: false; error: string }

const PIN_PATTERN = /^\d{6}$/
// Ban far into the future to disable sign-in + token refresh (~100 years).
const FOREVER_BAN = '876000h'

// IDs of every active user whose role is the built-in Super Admin.
async function activeSuperadminIds(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin
    .from('profiles')
    .select('id, roles!inner(is_system)')
    .eq('active', true)
    .eq('roles.is_system', true)
  return ((data ?? []) as { id: string }[]).map(r => r.id)
}

async function roleIsSuperadmin(admin: SupabaseClient, roleId: string): Promise<boolean> {
  const { data } = await admin.from('roles').select('is_system').eq('id', roleId).single()
  return !!data?.is_system
}

export async function createEmployee(input: {
  username: string
  pin: string
  fullName: string
  roleId: string
}): Promise<ActionResult> {
  const gate = await requirePermission('staff.manage')
  if (!gate.ok) return gate

  const username = input.username.trim()
  const fullName = input.fullName.trim() || username
  const { pin, roleId } = input

  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: 'User ID must be 3–30 letters, numbers, dot, dash or underscore.' }
  }
  if (!PIN_PATTERN.test(pin)) return { ok: false, error: 'PIN must be exactly 6 digits.' }
  if (!roleId) return { ok: false, error: 'Please choose a role.' }

  const admin = createAdminClient()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: pin,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  })
  if (createErr || !created.user) {
    const dup = createErr?.message?.toLowerCase().includes('already')
    return { ok: false, error: dup ? 'That User ID is already taken.' : (createErr?.message ?? 'Could not create employee.') }
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    username,
    full_name: fullName,
    role_id: roleId,
    active: true,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    const dup = profileErr.message.toLowerCase().includes('duplicate') || profileErr.code === '23505'
    return { ok: false, error: dup ? 'That User ID is already taken.' : 'Could not save employee profile.' }
  }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function resetPin(input: { id: string; pin: string }): Promise<ActionResult> {
  const gate = await requirePermission('staff.manage')
  if (!gate.ok) return gate

  if (!PIN_PATTERN.test(input.pin)) return { ok: false, error: 'PIN must be exactly 6 digits.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(input.id, { password: input.pin })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function updateEmployee(input: {
  id: string
  fullName: string
  roleId: string
}): Promise<ActionResult> {
  const gate = await requirePermission('staff.manage')
  if (!gate.ok) return gate

  const fullName = input.fullName.trim()
  const { id, roleId } = input
  if (!fullName) return { ok: false, error: 'Name is required.' }
  if (!roleId) return { ok: false, error: 'Please choose a role.' }

  const admin = createAdminClient()

  // Lockout guard: don't let the last active Super Admin be moved off the role.
  const becomingSuperadmin = await roleIsSuperadmin(admin, roleId)
  const supers = await activeSuperadminIds(admin)
  if (wouldRemoveLastSuperadmin(supers, id, becomingSuperadmin)) {
    return { ok: false, error: 'You cannot remove the last Super Admin. Assign another first.' }
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    user_metadata: { full_name: fullName },
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({ full_name: fullName, role_id: roleId })
    .eq('id', id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function deleteEmployee(input: { id: string }): Promise<ActionResult> {
  const gate = await requirePermission('staff.manage')
  if (!gate.ok) return gate

  // Don't let an admin delete themselves and risk locking everyone out.
  if (input.id === gate.userId) {
    return { ok: false, error: 'You cannot delete your own account.' }
  }

  const admin = createAdminClient()

  // Lockout guard: deleting the last active Super Admin would lock out role management.
  const supers = await activeSuperadminIds(admin)
  if (wouldRemoveLastSuperadmin(supers, input.id, false)) {
    return { ok: false, error: 'You cannot delete the last Super Admin.' }
  }

  // Remove the login first: a partial failure must never leave a sign-in-capable
  // user with no profile (the orphan case createEmployee also guards against).
  const { error: authErr } = await admin.auth.admin.deleteUser(input.id)
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin.from('profiles').delete().eq('id', input.id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function setActive(input: { id: string; active: boolean }): Promise<ActionResult> {
  const gate = await requirePermission('staff.manage')
  if (!gate.ok) return gate

  // Don't let an admin deactivate themselves.
  if (input.id === gate.userId && !input.active) {
    return { ok: false, error: 'You cannot deactivate your own account.' }
  }

  const admin = createAdminClient()

  // Lockout guard: deactivating the last active Super Admin would lock out role management.
  if (!input.active) {
    const supers = await activeSuperadminIds(admin)
    if (wouldRemoveLastSuperadmin(supers, input.id, false)) {
      return { ok: false, error: 'You cannot deactivate the last Super Admin.' }
    }
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(input.id, {
    ban_duration: input.active ? 'none' : FOREVER_BAN,
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({ active: input.active })
    .eq('id', input.id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}
