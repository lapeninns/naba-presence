"use client"

import { CircleAlert, RefreshCw, Unplug } from "lucide-react"
import Link from "next/link"

import { SupportDetails } from "@/components/editors/support-details"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { QueryPending } from "@/components/ui/query-states"
import { ApiClientError } from "@/lib/api/client"
import {
  describeActionError,
  isNotLinkedError,
} from "@/lib/errors/action-errors"
import { cn } from "@/lib/utils"

/**
 * The pending state for every per-location tab.
 *
 * It takes a label because its sibling `TabError` below spends real care
 * telling "not linked to Google yet" apart from a genuine failure, while the
 * loading path said nothing at all — for the five to ten seconds that Google's
 * fan-out actually takes.
 */
export function TabLoading({ label }: { label?: string } = {}) {
  return <QueryPending label={label} />
}

/**
 * A failed load (reference error view): a card with the failure mark, what
 * went wrong in words, "Try again", and — folded behind "Details for
 * support" — the safe error code and request id when the API sent them.
 * Announced as an alert. Never an empty state — a failed fetch is not
 * "nothing here".
 */
export function TabError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  // No Google link is a distinct state the tab can act on, not a failure.
  if (isNotLinkedError(error)) {
    return (
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
          icon={<Unplug aria-hidden />}
          title="This location isn’t linked to Google yet"
          description="Link it to Google Business Profile to manage its details, hours, photos and more here. Owners and admins link listings from Setup."
          action={
            <Link
              href="/setup"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Link it in Setup
            </Link>
          }
        />
      </div>
    )
  }
  const details =
    error instanceof ApiClientError
      ? [error.code, error.requestId ? `Request ${error.requestId}` : null]
      : []
  return (
    <div
      role="alert"
      className="rounded-(--np-radius-card) border border-line bg-surface"
    >
      <Empty
        tone="bad"
        icon={<CircleAlert aria-hidden />}
        title="We couldn’t load this section"
        description={`${describeActionError(error)} Nothing was changed.`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
            <SupportDetails items={details} />
          </div>
        }
      />
    </div>
  )
}
