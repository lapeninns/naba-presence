"use client"

import {
  BoundaryErrorState,
  BoundaryFrame,
} from "@/components/app-shell/boundary"
import { useWorkspaceMode } from "@/lib/workspace/mode"

// The reports page owns its <main> through PageFrame, so the boundary that
// replaces it supplies the page frame too. Light helpers only
// (components/app-shell/boundary.tsx): this file is its own chunk.
export default function ReportsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const business = useWorkspaceMode() === "business"
  return (
    <BoundaryFrame width="wide">
      <BoundaryErrorState
        title="Reports hit an error"
        description={`Nothing was changed, and the rest of NabaPresence is still working. Try again, or open your ${business ? "listings" : "clients"} to carry on.`}
        onReset={reset}
        homeHref={business ? "/listings" : "/clients"}
        homeLabel={business ? "Go to Listings" : "Go to Clients"}
      />
    </BoundaryFrame>
  )
}
