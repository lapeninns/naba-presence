"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import { PageFrame } from "@/components/app-shell/page-frame"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

// The inbox page owns its <main> via PageFrame, so the boundary that replaces
// it must supply the landmark too.
//
// "Back to Inbox" is not a link: a review that broke the page is still in the
// URL (`?selected=`), and Next keeps this boundary up across a navigation
// that stays on /inbox. So the way back drops the review from the URL and
// resets the boundary in one go, landing on the list on every screen size.
export default function InboxError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <div className="mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6">
        <Alert variant="destructive">
          <AlertTitle>The inbox hit an error</AlertTitle>
          <AlertDescription>
            Your reviews and drafts are safe, and the rest of NabaPresence is
            still working. Try again, or go back to Inbox.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Button
            variant="outline"
            onClick={() =>
              startTransition(() => {
                router.replace("/inbox")
                reset()
              })
            }
          >
            Back to Inbox
          </Button>
        </div>
      </div>
    </PageFrame>
  )
}
