'use client'

import { ErrorState } from '@/components/ui/error-state'

export default function CustomersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load clinics"
      description="There was a problem loading the clinic list. Please try again."
      onRetry={reset}
    />
  )
}
