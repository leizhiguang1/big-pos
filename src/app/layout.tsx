import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BigPOS',
  description: 'Point of Sale System',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
