'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import { updateMyProfile, changeMyPin } from '@/lib/auth/account-actions'

export default function ProfileManager() {
  const { user, username, roleName } = useAuth()

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your own login.</p>
      </div>

      <Card>
        <CardContent className="space-y-1 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
          <p className="text-sm text-muted-foreground">User ID: <span className="font-medium">{username}</span></p>
          <p className="text-sm text-muted-foreground">Role: <span className="font-medium">{roleName}</span></p>
        </CardContent>
      </Card>

      <NameForm initial={(user?.user_metadata?.full_name as string) ?? ''} />
      <PinForm />
    </div>
  )
}

function NameForm({ initial }: { initial: string }) {
  const [fullName, setFullName] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    start(async () => {
      const res = await updateMyProfile({ fullName })
      setMsg(res.ok ? { ok: true, text: 'Name updated.' } : { ok: false, text: (res as { error: string }).error })
    })
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <form onSubmit={save} className="space-y-3">
          <Label>Display name</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          {msg && <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>{msg.text}</p>}
          <Button className="w-full sm:w-auto" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save name'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PinForm() {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (pin !== confirm) { setMsg({ ok: false, text: 'PINs do not match.' }); return }
    start(async () => {
      const res = await changeMyPin({ pin })
      if (res.ok) { setMsg({ ok: true, text: 'PIN changed.' }); setPin(''); setConfirm('') }
      else setMsg({ ok: false, text: (res as { error: string }).error })
    })
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <form onSubmit={save} className="space-y-3">
          <Label>Change PIN (6 digits)</Label>
          <Input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="New PIN" />
          <Input type="password" inputMode="numeric" maxLength={6} value={confirm}
            onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Confirm new PIN" />
          {msg && <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>{msg.text}</p>}
          <Button className="w-full sm:w-auto" type="submit" disabled={pending || pin.length !== 6}>{pending ? 'Saving…' : 'Change PIN'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
