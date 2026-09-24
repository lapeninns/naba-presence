import Link from "next/link"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { nullableCell } from "@/components/reporting/reporting-states"
import type { AnalyticsLocation } from "@/lib/api/analytics"
import type { CsvCell } from "@/lib/reporting/csv"
import { cn } from "@/lib/utils"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

// Order by response rate desc, nulls last (missing ≠ 0), then by name.
function orderLocations(locations: AnalyticsLocation[]): AnalyticsLocation[] {
  return [...locations].sort((a, b) => {
    if (a.responseRate === null && b.responseRate === null)
      return a.name.localeCompare(b.name)
    if (a.responseRate === null) return 1
    if (b.responseRate === null) return -1
    return b.responseRate - a.responseRate || a.name.localeCompare(b.name)
  })
}

/**
 * The table as CSV rows, in the order it is shown. Raw figures (a rate as a
 * fraction, a median in seconds) so a spreadsheet can compute with them; a
 * missing figure is an empty cell, never 0.
 */
export function replyLocationsCsv(locations: AnalyticsLocation[]): CsvCell[][] {
  return [
    [
      "Location",
      "Reviews",
      "Average rating",
      "Response rate",
      "Median response (seconds)",
      "Unresolved",
    ],
    ...orderLocations(locations).map((location) => [
      location.name,
      location.reviews,
      location.averageRating,
      location.responseRate,
      location.medianFirstResponseSeconds,
      location.unresolvedComplaints,
    ]),
  ]
}

const LINK_CLASS =
  "rounded-(--np-radius-tag) break-words underline decoration-line-strong underline-offset-3 focus-halo hover:decoration-current pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"

export function ReplyLocationsTable({
  locations,
  linked = true,
}: {
  locations: AnalyticsLocation[]
  /**
   * Names and counts open the location's report and inbox. Off for the
   * public shared report, which has no way into the app.
   */
  linked?: boolean
}) {
  const rows = orderLocations(locations)
  return (
    <Table surface responsive>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead numeric>Reviews</TableHead>
          <TableHead numeric>Avg rating</TableHead>
          <TableHead numeric>Response rate</TableHead>
          <TableHead numeric>Median response</TableHead>
          <TableHead numeric>Unresolved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((location) => {
          const rating = nullableCell(location.averageRating, (v) =>
            v.toFixed(1)
          )
          const rate = nullableCell(location.responseRate, (v) =>
            formatPercent(v)
          )
          const median = nullableCell(
            location.medianFirstResponseSeconds,
            (v) => formatDuration(v)
          )
          const id = encodeURIComponent(location.id)
          return (
            <TableRow key={location.id}>
              <TableCell className="font-medium text-ink">
                {/* The location's own report: same figures, one place. */}
                {linked ? (
                  <Link
                    href={`/reports?locationId=${id}`}
                    className={LINK_CLASS}
                  >
                    {location.name}
                  </Link>
                ) : (
                  <span className="break-words">{location.name}</span>
                )}
              </TableCell>
              <TableCell numeric label="Reviews">
                {formatNumber(location.reviews)}
              </TableCell>
              <TableCell
                numeric
                label="Avg rating"
                className={cn(rating.isNull && "text-ink-muted")}
              >
                {rating.text}
              </TableCell>
              <TableCell
                numeric
                label="Response rate"
                className={cn(rate.isNull && "text-ink-muted")}
              >
                {rate.text}
              </TableCell>
              <TableCell
                numeric
                label="Median response"
                className={cn(median.isNull && "text-ink-muted")}
              >
                {median.text}
              </TableCell>
              <TableCell numeric label="Unresolved">
                {linked && location.unresolvedComplaints > 0 ? (
                  // The count is work waiting (one- and two-star reviews
                  // with no published reply), so it opens those reviews in
                  // the inbox rather than being a dead number.
                  <Link
                    href={`/inbox?locationId=${id}&rating=1,2`}
                    className={LINK_CLASS}
                    aria-label={`${formatNumber(location.unresolvedComplaints)} unresolved at ${location.name}, open in the inbox`}
                  >
                    {formatNumber(location.unresolvedComplaints)}
                  </Link>
                ) : (
                  formatNumber(location.unresolvedComplaints)
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
