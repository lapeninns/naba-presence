"use client"

import { RouteErrorState } from "@/components/ui/query-states"

// app/(dashboard)/(business)/layout.tsx owns the ONLY <main> for the flat
// business surface (/profile, /photos, /posts); this boundary only replaces
// the page inside it.
export default function BusinessError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteErrorState
      title="This section hit an error"
      description="Nothing has been published to Google. The rest of NabaPresence is still working. Try again, or go back to Home."
      onReset={reset}
    />
  )
}
