import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

// Service-role client: bypasses RLS and can use the Auth admin API (create users,
// set passwords, ban). It must NEVER reach the browser — only import this from
// server actions / route handlers, never from a Client Component.
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient must only be used on the server')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL')
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
