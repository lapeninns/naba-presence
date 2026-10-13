"use client"

import { RefreshCw, Unplug } from "lucide-react"
import Link from "next/link"

import { SupportDetails } from "@/components/editors/support-details"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
 * A failed load (reference error view): a card holding the shared
 * `<Empty variant="error">` state (its failure mark and tone), what went
 * wrong in words, "Try again", and — folded behind "Details for support" —
 * the safe error code and request id when the API sent them. Announced as
 * an alert. Never a plain empty state — a failed fetch is not "nothing
 * here". A location with no Google link is the not-enabled state instead.
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
      <Card flush>
        {/* Not a failure: the not-enabled state, with the plug glyph that
            says what is missing. */}
        <Empty
          variant="not-enabled"
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
      </Card>
    )
  }
  const details =
    error instanceof ApiClientError
      ? [error.code, error.requestId ? `Request ${error.requestId}` : null]
      : []
  return (
    <Card flush>
      {/* The shared failed-load state (QueryError's drawing: the error
          variant, announced as an alert). Drawn here rather than through
          QueryError because its action also carries the support details. */}
      <Empty
        role="alert"
        variant="error"
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
    </Card>
  )
}
