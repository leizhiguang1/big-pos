'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronRight, ClipboardList } from 'lucide-react'

const sections = [
  {
    href: '/settings/service-statuses',
    icon: ClipboardList,
    title: 'Service Statuses',
    description: 'Delivery-note instructions to the doctor (Try in, Redo, Final…).',
  },
]

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure lookups and defaults used across the app.</p>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {sections.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
