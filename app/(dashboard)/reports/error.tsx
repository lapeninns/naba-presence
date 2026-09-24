"use client"

import { PageFrame } from "@/components/app-shell/page-frame"
import { RouteErrorState } from "@/components/ui/query-states"

// The reports page owns its <main> through PageFrame, so the boundary that
// replaces it supplies the landmark too.
export default function ReportsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageFrame width="wide">
      <RouteErrorState
        title="Reports hit an error"
        description="Nothing was changed, and the rest of NabaPresence is still working. Try again, or open your clients to carry on."
        onReset={reset}
        homeHref="/clients"
        homeLabel="Go to Clients"
      />
    </PageFrame>
  )
}
