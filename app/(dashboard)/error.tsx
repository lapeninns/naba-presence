"use client"

import { RouteErrorState } from "@/components/ui/query-states"

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // This boundary replaces the whole page, so it owns the <main> landmark.
  return (
    <main id="main" tabIndex={-1}>
      <RouteErrorState
        title="This page hit an error"
        description="The rest of NabaPresence is still working. Try again, or go back to Home."
        onReset={reset}
      />
    </main>
  )
}
