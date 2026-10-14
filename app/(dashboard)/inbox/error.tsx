"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import {
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import { Empty } from "@/components/ui/empty"

// The inbox page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
//
// Drawn as the shared boundary error state (BoundaryErrorState in
// components/app-shell/boundary.tsx): the calm `Empty variant="error"`
// announced as an alert, with the actions outside it. Composed here rather
// than used as-is because its way out is a plain link, and "Back to Inbox"
// is not a link: a review that broke the page is still in the URL
// (`?selected=`), and Next keeps this boundary up across a navigation that
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
      <div
        data-slot="boundary-error-state"
        className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-5 pt-10 pb-6 text-center md:pt-20"
      >
        <Empty
          variant="error"
          data-slot="alert"
          role="alert"
          className="px-0 py-0 sm:py-0 lg:py-0"
          title={<span data-slot="alert-title">The inbox hit an error</span>}
          description={
            <span data-slot="alert-description">
              Your reviews and drafts are safe, and the rest of NabaPresence is
              still working. Try again, or go back to Inbox.
            </span>
          }
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={boundaryButtonClass(
              "primary",
              "default",
              "pointer-coarse:min-h-11"
            )}
            onClick={() => reset()}
          >
            Try again
          </button>
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
        </div>
      </div>
    </BoundaryFrame>
  )
}
