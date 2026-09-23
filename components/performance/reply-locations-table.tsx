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

export function ReplyLocationsTable({
  locations,
}: {
  locations: AnalyticsLocation[]
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
          return (
            <TableRow key={location.id}>
              <TableCell className="font-medium text-ink">
                {/* The location's own report: same figures, one place. */}
                <Link
                  href={`/reports?locationId=${encodeURIComponent(location.id)}`}
                  className="break-words underline decoration-line-strong underline-offset-3 hover:decoration-current"
                >
                  {location.name}
                </Link>
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
                {formatNumber(location.unresolvedComplaints)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
