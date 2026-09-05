"use client"

import { TriangleAlert } from "lucide-react"

import { PageEmptyState } from "@/components/app-shell/page-frame"
import { Button } from "@/components/ui/button"

/**
 * The page failed; the shell around it did not. The sidebar and toolbar are
 * still there, so the one action offered is the one only this boundary can
 * perform: try the page again.
 */
export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // This boundary replaces the whole page, so it owns the <main> landmark.
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-(--np-page-max-width) flex-col px-5 py-6 outline-none md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <PageEmptyState
        icon={<TriangleAlert strokeWidth={1.75} aria-hidden />}
        title="This page hit an error"
        description="The rest of NabaPresence is still working. Your data is unaffected."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  )
}
