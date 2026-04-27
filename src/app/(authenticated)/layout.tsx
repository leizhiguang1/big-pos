import { AuthProvider } from '@/contexts/AuthContext'
import AppShell from '@/components/layout/AppShell'

export const dynamic = 'force-dynamic'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
