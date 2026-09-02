"use client"

import { PageFrame } from "@/components/app-shell/page-frame"
import { RouteErrorState } from "@/components/ui/query-states"

// The home page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
export default function HomeError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageFrame width="wide">
      <RouteErrorState
        title="Home hit an error"
        description="The rest of NabaPresence is still working. Try again, or open the inbox."
        onReset={reset}
        homeHref="/inbox"
      />
    </PageFrame>
  )
}
