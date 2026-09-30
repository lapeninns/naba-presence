"use client"

import type { PresenceResponse } from "@/lib/contracts/analytics"
import { formatDate, formatDateTime } from "@/lib/format"

/**
 * Where a Google figure comes from: the last day Google has reported
 * (Google's own daily dates, never shifted into another zone), when we last
 * fetched successfully, and how many locations in scope are reporting.
 * "Data through" and "last fetched" are different facts: a fetch today can
 * still only carry data through last week.
 */
export function PresenceProvenance({ data }: { data: PresenceResponse }) {
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const coverage = data.coverage
  const parts = [
    data.freshThrough
      ? `Data through ${formatDate(data.freshThrough, "UTC")} (Google’s daily dates)`
      : "No Google data in this window",
    data.fetchedAt?.oldest
      ? data.fetchedAt.oldest === data.fetchedAt.newest
        ? `Last fetched ${formatDateTime(data.fetchedAt.oldest, viewerZone)}`
        : `Last fetched between ${formatDateTime(data.fetchedAt.oldest, viewerZone)} and ${formatDateTime(data.fetchedAt.newest ?? data.fetchedAt.oldest, viewerZone)}`
      : "Not fetched successfully yet",
  ]
  const coverageParts = coverage
    ? [
        `${coverage.reporting} of ${coverage.eligible} ${coverage.eligible === 1 ? "location" : "locations"} reporting`,
        coverage.unavailable ? `${coverage.unavailable} unavailable` : null,
        coverage.stale ? `${coverage.stale} stale` : null,
        coverage.pending ? `${coverage.pending} not fetched yet` : null,
      ].filter((part): part is string => part !== null)
    : []
  return (
    <div className="flex flex-col gap-0.5 text-caption text-ink-muted">
      <p className="tabular-nums">{parts.join(" · ")}</p>
      {coverageParts.length ? (
        <p className="tabular-nums" data-slot="presence-coverage">
          {coverageParts.join(" · ")}
        </p>
      ) : null}
    </div>
  )
}
