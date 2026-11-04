"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import {
  BoundaryErrorState,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"

// The reports page owns its <main> through PageFrame, so the boundary that
// replaces it supplies the page frame too.
//
// "Whole report" is not a link: a report that broke under `?locationId=`,
// `?tab=` or a period is still in the address, and Next keeps this boundary
// up across a navigation that stays on /reports. So the way back drops the
// report's own choices, keeps the scope (`?clientId=`), and resets the
// boundary in one go. The shell's own navigation stays on screen for
// anywhere else.
//
// Light helpers only (components/app-shell/boundary.tsx): this file is its
// own chunk.
function wholeReportHref(search: string) {
  const clientId = new URLSearchParams(search).get("clientId")
  return clientId
    ? `/reports?clientId=${encodeURIComponent(clientId)}`
    : "/reports"
}

export default function ReportsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  return (
    <BoundaryFrame width="wide">
      <BoundaryErrorState
        title="Reports hit an error"
        description="Nothing was changed. Your listings are safe."
        onReset={reset}
        secondaryAction={
          <button
            type="button"
            className={boundaryButtonClass(
              "ghost",
              "default",
              "pointer-coarse:min-h-11"
            )}
            onClick={() =>
              startTransition(() => {
                router.replace(wholeReportHref(window.location.search))
                reset()
              })
            }
          >
            Whole report
          </button>
        }
      />
    </BoundaryFrame>
  )
}
