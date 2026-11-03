"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import {
  BoundaryErrorState,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"

// The inbox page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
//
// "Back to Inbox" is not a link: a review that broke the page is still in the
// URL (`?selected=`), and Next keeps this boundary up across a navigation that
// stays on /inbox. So the way back drops the review from the URL and resets
// the boundary in one go, landing on the list on every screen size.
//
// Light helpers only (components/app-shell/boundary.tsx): this file is its
// own chunk.
export default function InboxError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  return (
    <BoundaryFrame width="workspace">
      <BoundaryErrorState
        title="The inbox hit an error"
        description="Nothing was changed. Your drafts are safe."
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
                router.replace("/inbox")
                reset()
              })
            }
          >
            Back to Inbox
          </button>
        }
      />
    </BoundaryFrame>
  )
}
