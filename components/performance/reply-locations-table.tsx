import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { nullableCell } from "@/components/reporting/reporting-states"
import type { AnalyticsLocation } from "@/lib/api/analytics"
import { cn } from "@/lib/utils"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

// Order by response rate desc, nulls last (missing ≠ 0), then by name.
function orderLocations(locations: AnalyticsLocation[]): AnalyticsLocation[] {
  return [...locations].sort((a, b) => {
    if (a.responseRate === null && b.responseRate === null) return a.name.localeCompare(b.name)
    if (a.responseRate === null) return 1
    if (b.responseRate === null) return -1
    return b.responseRate - a.responseRate || a.name.localeCompare(b.name)
  })
}

export function ReplyLocationsTable({ locations }: { locations: AnalyticsLocation[]; timezone?: string }) {
  const rows = orderLocations(locations)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Reviews</TableHead>
          <TableHead className="text-right">Avg rating</TableHead>
          <TableHead className="text-right">Response rate</TableHead>
          <TableHead className="text-right">Median response</TableHead>
          <TableHead className="text-right">Unresolved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((location) => {
          const rating = nullableCell(location.averageRating, (v) => v.toFixed(1))
          const rate = nullableCell(location.responseRate, (v) => formatPercent(v))
          const median = nullableCell(location.medianFirstResponseSeconds, (v) => formatDuration(v))
          return (
            <TableRow key={location.id}>
              <TableCell className="font-medium">{location.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(location.reviews)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", rating.isNull && "text-muted-foreground")}>{rating.text}</TableCell>
              <TableCell className={cn("text-right tabular-nums", rate.isNull && "text-muted-foreground")}>{rate.text}</TableCell>
              <TableCell className={cn("text-right tabular-nums", median.isNull && "text-muted-foreground")}>{median.text}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(location.unresolvedComplaints)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
