"use client"

import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"

const HEADING_ID = "needs-attention-heading"
const MAX_ROWS = 5

function AttentionList() {
  const analytics = useAnalyticsOverview()

  function renderBody() {
    if (analytics.isPending) {
      return (
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 rounded-(--nr-radius-card)" />
          ))}
        </div>
      )
    }

    if (analytics.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>
            We could not load locations that need attention.
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Check your connection, then try again.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void analytics.refetch()
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )
    }

    const rows = [...analytics.data.locations]
      .filter((location) => location.unresolvedComplaints > 0)
      .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
      .slice(0, MAX_ROWS)

    if (rows.length === 0) {
      return (
        <p className="text-ui text-muted-foreground">
          No locations need attention right now.
        </p>
      )
    }

    return (
      <ul className="flex flex-col overflow-hidden rounded-(--nr-radius-card) border border-[var(--nr-surface-glass-border)] bg-card">
        {rows.map((location) => (
          <li
            key={location.id}
            className="border-b border-border/60 last:border-b-0"
          >
            {/* /inbox 404s until M4; viewport-prefetch of a 404 route keeps
                Chrome from reaching networkidle and destabilises Task 7's
                console/axe guards - mirror nav.tsx and stay prefetch={false}. */}
            <Link
              href={`/inbox?locationId=${location.id}`}
              prefetch={false}
              className="flex items-center justify-between gap-3 px-4 py-3 text-ui transition-colors duration-(--nr-duration-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
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
      <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
        Locations needing attention
      </h2>
      {renderBody()}
    </section>
  )
}

export { AttentionList }
