import { createClient } from '@/lib/supabase/server'
import { permissionGranted } from '@/lib/permissions'

export type PermissionCheck =
  | { ok: true; userId: string }
  | { ok: false; error: string }

// Shape returned by the profiles->roles->role_permissions embed.
type ProfileWithRole = {
  active: boolean
  roles: { is_system: boolean; role_permissions: { permission: string }[] } | null
}

async function loadRole(): Promise<{ userId: string; profile: ProfileWithRole } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('active, roles(is_system, role_permissions(permission))')
    .eq('id', user.id)
    .single()

  if (!data) return null
  return { userId: user.id, profile: data as unknown as ProfileWithRole }
}

// Server-side gate. Reads role + permissions from the database (source of truth),
// so a freshly-changed role takes effect without re-login and a forged token
// can't grant access.
export async function requirePermission(permission: string): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles) return { ok: false, error: 'Access denied' }

  const granted = permissionGranted(
    { is_system: profile.roles.is_system, permissions: profile.roles.role_permissions.map(p => p.permission) },
    permission,
  )
  if (!granted) return { ok: false, error: 'You do not have permission to do this.' }
  return { ok: true, userId }
}

// Gate for role management — Super Admin only.
export async function requireSuperadmin(): Promise<PermissionCheck> {
  const loaded = await loadRole()
  if (!loaded) return { ok: false, error: 'Not signed in' }
  const { userId, profile } = loaded
  if (!profile.active || !profile.roles?.is_system) {
    return { ok: false, error: 'Super Admin access required' }
  }
  return { ok: true, userId }
}
