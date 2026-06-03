'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/require-admin'
import { usernameToEmail, USERNAME_PATTERN } from '@/lib/auth/username'
import type { ProfileRole } from '@/lib/database.types'

export type ActionResult = { ok: true } | { ok: false; error: string }

const PIN_PATTERN = /^\d{6}$/
const ROLES: ProfileRole[] = ['admin', 'staff']
// Ban far into the future to disable sign-in + token refresh (~100 years).
const FOREVER_BAN = '876000h'

function isRole(value: string): value is ProfileRole {
  return (ROLES as string[]).includes(value)
}

export async function createEmployee(input: {
  username: string
  pin: string
  fullName: string
  role: string
}): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const username = input.username.trim()
  const fullName = input.fullName.trim() || username
  const { pin, role } = input

  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: 'User ID must be 3–30 letters, numbers, dot, dash or underscore.' }
  }
  if (!PIN_PATTERN.test(pin)) return { ok: false, error: 'PIN must be exactly 6 digits.' }
  if (!isRole(role)) return { ok: false, error: 'Invalid role.' }

  const admin = createAdminClient()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: pin,
    email_confirm: true,
    user_metadata: { username, full_name: fullName, role },
    app_metadata: { role },
  })
  if (createErr || !created.user) {
    const dup = createErr?.message?.toLowerCase().includes('already')
    return { ok: false, error: dup ? 'That User ID is already taken.' : (createErr?.message ?? 'Could not create employee.') }
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    username,
    full_name: fullName,
    role,
    active: true,
  })
  if (profileErr) {
    // Roll back the auth user so we don't leave an orphan that can log in with no profile.
    await admin.auth.admin.deleteUser(created.user.id)
    const dup = profileErr.message.toLowerCase().includes('duplicate') || profileErr.code === '23505'
    return { ok: false, error: dup ? 'That User ID is already taken.' : 'Could not save employee profile.' }
  }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function resetPin(input: { id: string; pin: string }): Promise<ActionResult> {
  const gate = await requireAdmin()
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
  role: string
}): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const fullName = input.fullName.trim()
  const { id, role } = input
  if (!fullName) return { ok: false, error: 'Name is required.' }
  if (!isRole(role)) return { ok: false, error: 'Invalid role.' }
  // Stop an admin from demoting themselves and locking everyone out.
  if (id === gate.userId && role !== 'admin') {
    return { ok: false, error: 'You cannot remove your own admin role.' }
  }

  const admin = createAdminClient()
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    user_metadata: { full_name: fullName, role },
    app_metadata: { role },
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({ full_name: fullName, role })
    .eq('id', id)
  if (profileErr) return { ok: false, error: profileErr.message }

  revalidatePath('/settings/employees')
  return { ok: true }
}

export async function setActive(input: { id: string; active: boolean }): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  // Don't let an admin deactivate themselves.
  if (input.id === gate.userId && !input.active) {
    return { ok: false, error: 'You cannot deactivate your own account.' }
  }

  const admin = createAdminClient()
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
