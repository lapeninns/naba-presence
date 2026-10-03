"use client"

import { PageFrame } from "@/components/app-shell/page-frame"
import { RouteErrorState } from "@/components/ui/query-states"
import { useWorkspaceMode } from "@/lib/workspace/mode"

// The reports page owns its <main> through PageFrame, so the boundary that
// replaces it supplies the landmark too.
export default function ReportsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const business = useWorkspaceMode() === "business"
  return (
    <PageFrame width="wide">
      <RouteErrorState
        title="Reports hit an error"
        description={`Nothing was changed, and the rest of NabaPresence is still working. Try again, or open your ${business ? "listings" : "clients"} to carry on.`}
        onReset={reset}
        homeHref={business ? "/listings" : "/clients"}
        homeLabel={business ? "Go to Listings" : "Go to Clients"}
      />
    </PageFrame>
  )
}
