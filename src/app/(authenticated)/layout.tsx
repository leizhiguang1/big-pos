import { AuthProvider } from '@/contexts/AuthContext'
import AppShell from '@/components/layout/AppShell'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
