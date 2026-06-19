'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { settingsGroups } from '@/domain/navigation'

// /settings has no content of its own — it forwards to the first section the
// user can reach (no more tile grid). A user with no config permission is sent
// to the dashboard; the sidebar wouldn't have shown them Settings anyway.
export default function SettingsIndex() {
  const { hasPermission, isSuperadmin, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const first = settingsGroups({ hasPermission, isSuperadmin })[0]?.entries[0]?.href
    router.replace(first ?? '/dashboard')
  }, [loading, hasPermission, isSuperadmin, router])

  return <p className="text-sm text-gray-400">Loading…</p>
}
