'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/auth/employee-actions'

const PIN_PATTERN = /^\d{6}$/

// Self-service account actions. These operate EXCLUSIVELY on the caller's own
// record (resolved from the session) and accept no target id — so they can
// never be used to modify another user. Distinct from the staff.manage-gated
// admin actions in employee-actions.ts.
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function updateMyProfile(input: { fullName: string }): Promise<ActionResult> {
  const id = await currentUserId()
  if (!id) return { ok: false, error: 'Not signed in' }

  const fullName = input.fullName.trim()
  if (!fullName) return { ok: false, error: 'Name is required.' }

  const admin = createAdminClient()
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    user_metadata: { full_name: fullName },
  })
  if (authErr) return { ok: false, error: authErr.message }

  const { error } = await admin.from('profiles').update({ full_name: fullName }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/profile')
  return { ok: true }
}

export async function changeMyPin(input: { pin: string }): Promise<ActionResult> {
  const id = await currentUserId()
  if (!id) return { ok: false, error: 'Not signed in' }
  if (!PIN_PATTERN.test(input.pin)) return { ok: false, error: 'PIN must be exactly 6 digits.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(id, { password: input.pin })
  if (error) return { ok: false, error: error.message }

  return { ok: true }
}
