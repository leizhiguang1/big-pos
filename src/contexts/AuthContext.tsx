'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Permission } from '@/domain/permissions'

interface AuthContextType {
  session: Session | null
  user: Session['user'] | null
  username: string
  roleName: string
  isSuperadmin: boolean
  hasPermission: (permission: Permission) => boolean
  loading: boolean
  signOut: () => Promise<void>
}

const noPerms = () => false

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  username: '',
  roleName: '',
  isSuperadmin: false,
  hasPermission: noPerms,
  loading: true,
  signOut: async () => {},
})

type RoleInfo = { name: string; isSuperadmin: boolean; permissions: Set<string> }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<RoleInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadRole = async (userId: string): Promise<RoleInfo | null> => {
      const { data } = await supabase
        .from('profiles')
        .select('roles(name, is_system, role_permissions(permission))')
        .eq('id', userId)
        .single()
      const r = (data as { roles?: { name: string; is_system: boolean; role_permissions: { permission: string }[] } | null } | null)?.roles
      if (!r) return null
      return { name: r.name, isSuperadmin: r.is_system, permissions: new Set(r.role_permissions.map(p => p.permission)) }
    }

    const apply = async (s: Session | null) => {
      setSession(s)
      if (s?.user) {
        const info = await loadRole(s.user.id)
        if (active) setRole(info)
      } else if (active) {
        setRole(null)
      }
      if (active) setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => apply(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { apply(session) })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const signOut = async () => { await supabase.auth.signOut() }

  const username: string = session?.user?.user_metadata?.username ?? ''
  const isSuperadmin = role?.isSuperadmin ?? false
  const hasPermission = (permission: Permission) => isSuperadmin || (role?.permissions.has(permission) ?? false)

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      username,
      roleName: role?.name ?? '',
      isSuperadmin,
      hasPermission,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
