'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import { PERMISSION_GROUPS } from '@/domain/permissions'
import { updateMyProfile, changeMyPin } from '@/lib/auth/account-actions'

export default function ProfileManager() {
  const { user, username, roleName, isSuperadmin, hasPermission } = useAuth()

  const grantedLabels = PERMISSION_GROUPS.flatMap(g => g.permissions)
    .filter(p => hasPermission(p.key))
    .map(p => p.label)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your own login and see what your role can do.</p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Account</p>
          <p className="text-sm text-gray-700">User ID: <span className="font-medium">{username}</span></p>
          <p className="text-sm text-gray-700">Role: <span className="font-medium">{roleName}</span></p>
        </CardContent>
      </Card>

      <NameForm initial={(user?.user_metadata?.full_name as string) ?? ''} />
      <PinForm />

      <Card>
        <CardContent className="p-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">What I can do</p>
          {isSuperadmin ? (
            <p className="text-sm text-gray-700">All permissions (Super Admin).</p>
          ) : grantedLabels.length ? (
            <ul className="text-sm text-gray-700 list-disc pl-5 space-y-0.5">
              {grantedLabels.map(l => <li key={l}>{l}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No special permissions assigned.</p>
          )}
        </CardContent>
      </Card>
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
      <CardContent className="p-5">
        <form onSubmit={save} className="space-y-3">
          <Label>Display name</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          {msg && <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>{msg.text}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save name'}</Button>
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
      <CardContent className="p-5">
        <form onSubmit={save} className="space-y-3">
          <Label>Change PIN (6 digits)</Label>
          <Input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="New PIN" />
          <Input type="password" inputMode="numeric" maxLength={6} value={confirm}
            onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Confirm new PIN" />
          {msg && <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>{msg.text}</p>}
          <Button type="submit" disabled={pending || pin.length !== 6}>{pending ? 'Saving…' : 'Change PIN'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
