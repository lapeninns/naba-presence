"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import {
  BoundaryAlert,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"

// The inbox page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
//
// "Back to Inbox" is not a link: a review that broke the page is still in the
// URL (`?selected=`), and Next keeps this boundary up across a navigation
// that stays on /inbox. So the way back drops the review from the URL and
// resets the boundary in one go, landing on the list on every screen size.
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
      <div className="mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6">
        <BoundaryAlert title="The inbox hit an error">
          Your reviews and drafts are safe, and the rest of NabaPresence is
          still working. Try again, or go back to Inbox.
        </BoundaryAlert>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={boundaryButtonClass("primary")}
            onClick={() => reset()}
          >
            Try again
          </button>
          <button
            type="button"
            className={boundaryButtonClass("outline")}
            onClick={() =>
              startTransition(() => {
                router.replace("/inbox")
                reset()
              })
            }
          >
            Back to Inbox
          </button>
        </div>
      </div>
    </BoundaryFrame>
  )
}
