'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { COMPANY } from '@/lib/config'
import { usernameToEmail } from '@/lib/auth/username'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits.')
      return
    }
    setLoading(true)
    setError('')

    // Internal email constructed from username — never exposed to user
    const email = usernameToEmail(username)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: pin })

    if (authError) {
      setError('Invalid username or PIN. Please try again.')
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_430px]">
      <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:min-h-dvh lg:flex-col lg:justify-between">
        <div className="flex flex-1 items-center">
          <Image
            src="/chidental-rectangle.png"
            alt={COMPANY.name}
            width={680}
            height={183}
            priority
            className="h-auto w-full max-w-2xl object-contain object-left"
          />
        </div>
        <div className="border-t border-white/15 pt-6">
          <p className="text-xl font-semibold">Lab Management System</p>
          <div className="mt-3 space-y-1 text-sm leading-6 text-primary-foreground/70">
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone} · {COMPANY.email}</p>
          </div>
        </div>
      </section>

      <div className="flex min-h-dvh items-start justify-center px-4 py-12 sm:py-16 lg:min-h-0 lg:items-center lg:p-10">
        <div className="w-full min-w-0 max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <Image
              src="/chidental-rectangle.png"
              alt={COMPANY.name}
              width={317}
              height={86}
              priority
              className="mx-auto h-auto w-56 object-contain"
            />
            <p className="mt-3 text-sm text-muted-foreground">Lab Management System</p>
          </div>

          <Card className="w-full overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Staff Login</CardTitle>
              <CardDescription>Enter your User ID and 6-digit PIN</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">User ID</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="e.g. Jiaying123"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin">PIN (6 digits)</Label>
                  <Input
                    id="pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="••••••"
                    maxLength={6}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    autoComplete="current-password"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading || pin.length !== 6}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
