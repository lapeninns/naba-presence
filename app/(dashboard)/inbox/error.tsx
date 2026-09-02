"use client"

import { PageFrame } from "@/components/app-shell/page-frame"
import { RouteErrorState } from "@/components/ui/query-states"

// The inbox page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
export default function InboxError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <RouteErrorState
        title="The inbox hit an error"
        description="Your reviews and drafts are safe, and the rest of NabaPresence is still working. Try again, or go back to Home."
        onReset={reset}
      />
    </PageFrame>
  )
}
