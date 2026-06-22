'use client'

import { ErrorState } from '@/components/ui/error-state'

export default function ProductsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load products"
      description="There was a problem loading the product catalog. Please try again."
      onRetry={reset}
    />
  )
}
