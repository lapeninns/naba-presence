"use client"

import { ChevronRightIcon, CircleCheckIcon } from "lucide-react"
import Link from "next/link"

import {
  HomeSection,
  ListRowsSkeleton,
  listCardClassName,
  listRowClassName,
} from "@/components/home/home-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { StatusPill } from "@/components/ui/status-pill"
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
      return <ListRowsSkeleton rows={5} />
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
        <div className="rounded-(--np-radius-card) bg-surface">
          <Empty
            icon={<CircleCheckIcon />}
            title="Nothing needs attention"
            description="No locations have unresolved low ratings in the last 30 days."
            className="py-8"
          />
        </div>
      )
    }

    return (
      <ul className={listCardClassName}>
        {rows.map((location) => (
          <li key={location.id}>
            <Link
              href={`/inbox?locationId=${location.id}&rating=1,2`}
              prefetch={false}
              className={listRowClassName}
            >
              <StatusPill variant="dot" tone="at-risk" />
              <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                {location.name}
              </span>
              <span className="shrink-0 text-caption text-ink-muted tabular-nums">
                {`${formatNumber(location.unresolvedComplaints)} unresolved ${
                  location.unresolvedComplaints === 1
                    ? "complaint"
                    : "complaints"
                }`}
              </span>
              <ChevronRightIcon
                aria-hidden
                strokeWidth={1.75}
                className="size-4 shrink-0 text-ink-faint"
              />
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <HomeSection
      id={HEADING_ID}
      title="Locations needing attention"
      description="1–2 star reviews with no published reply · last 30 days"
    >
      {renderBody()}
    </HomeSection>
  )
}

export { AttentionList }
