"use client"

import { CircleAlertIcon, RotateCw } from "lucide-react"
import * as React from "react"

import { boundaryButtonClass } from "@/components/app-shell/boundary"
import { ShareStateCard } from "@/components/share/share-state-card"

/**
 * The report could not be read (the database, not the link). Says so without
 * detail, offers nothing but trying again, and links nowhere into the app.
 *
 * "Try again" re-runs the server page: Next 16.3+ passes that as `retry`
 * (`unstable_retry` before), while `reset` only re-renders the payload that
 * already failed. It reads the same link again, so a link that has died
 * meanwhile gets the same not-found page as any other.
 */
export default function ShareReportError({
  reset,
  retry,
  unstable_retry,
}: {
  reset: () => void
  retry?: () => void
  unstable_retry?: () => void
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <ShareStateCard
      icon={<CircleAlertIcon />}
      title="This report couldn’t be loaded"
      description="Something went wrong on our side. Try again in a moment."
      action={
        <button
          type="button"
          className={boundaryButtonClass("primary", "lg", "w-full")}
          // aria-disabled, not disabled: a disabled button drops the focus
          // it holds, and the retry is the one thing on the page.
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={() =>
            !pending &&
            startTransition(() => {
              ;(retry ?? unstable_retry ?? reset)()
            })
          }
        >
          <RotateCw strokeWidth={1.75} aria-hidden />
          {pending ? "Trying again…" : "Try again"}
        </button>
      }
    />
  )
}
