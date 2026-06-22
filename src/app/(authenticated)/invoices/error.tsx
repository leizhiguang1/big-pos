'use client'

import { ErrorState } from '@/components/ui/error-state'

export default function InvoicesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load invoices"
      description="There was a problem loading the invoice list. Please try again."
      onRetry={reset}
    />
  )
}
