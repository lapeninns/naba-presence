"use client"

import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber } from "@/lib/format"
import type { AnalyticsLocation } from "@/lib/api/analytics"

const HEADING_ID = "needs-attention-heading"
const MAX_ROWS = 5

function AttentionList({
  locations,
  isPending,
  isError,
  onRetry,
}: {
  locations: AnalyticsLocation[] | undefined
  isPending?: boolean
  isError?: boolean
  onRetry?: () => void
}) {
  function renderBody() {
    if (isPending) {
      return (
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-12 rounded-(--np-radius-card)" />
          ))}
        </div>
      )
    }

    if (isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>
            We could not load locations that need attention.
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Check your connection, then try again.</span>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      )
    }

    const rows = [...(locations ?? [])]
      .filter((location) => location.unresolvedComplaints > 0)
      .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
      .slice(0, MAX_ROWS)

    if (rows.length === 0) {
      return (
        <p className="text-ui text-muted-foreground">
          No locations have unresolved low ratings in the last 30 days.
        </p>
      )
    }

    return (
      <ul className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-border bg-card">
        {rows.map((location) => (
          <li
            key={location.id}
            className="border-b border-border/60 last:border-b-0"
          >
            <Link
              href={`/inbox?locationId=${location.id}&rating=1,2`}
              prefetch={false}
              className="flex items-center justify-between gap-3 px-4 py-3 text-ui transition-colors duration-(--np-duration-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <span className="min-w-0 truncate font-medium">
                {location.name}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                {`${formatNumber(location.unresolvedComplaints)} unresolved ${
                  location.unresolvedComplaints === 1
                    ? "complaint"
                    : "complaints"
                }`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
          Locations needing attention
        </h2>
        <p className="text-caption text-muted-foreground">
          1–2 star reviews with no published reply · last 30 days
        </p>
      </div>
      {renderBody()}
    </section>
  )
}

export { AttentionList }
