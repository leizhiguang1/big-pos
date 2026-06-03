import { createClient } from '@/lib/supabase/server'

export type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; error: string }

// Server-side gate for admin-only actions. Reads role from the profiles table
// (the source of truth) rather than the JWT, so a freshly-promoted admin works
// without re-login and a stale/forged token can't grant access.
export async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin' || !profile.active) {
    return { ok: false, error: 'Admin access required' }
  }

  return { ok: true, userId: user.id }
}
