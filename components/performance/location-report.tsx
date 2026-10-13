"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { LocationPerformance } from "@/components/performance/location-performance"
import { LocationSelect } from "@/components/performance/location-select"
import { RangeSelect } from "@/components/performance/range-select"
import { NotInDirectory } from "@/components/performance/report-scope"
import {
  ReportToolbar,
  reportToolbarFieldProps,
} from "@/components/reporting/report-toolbar"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"
import { buttonVariants } from "@/components/ui/button"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import {
  DEFAULT_RANGES,
  formatPeriod,
  REPLY_RANGES,
  resolvedPeriod,
  type ReplyRangeId,
} from "@/lib/reporting/ranges"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Reports scoped to one location.
 *
 * Performance used to be a tenth tab of the location workspace, which made a
 * report look like an editor. It is the same figures, reached from the
 * workspace, the client hub and the report's own Location field through
 * `?locationId=`, under the report toolbar: the location (switching to its
 * client's other locations), the period (`?range=`, owned by the page) and
 * the way back to the whole client.
 */
function LocationReport({
  locationId,
  rangeId = DEFAULT_RANGES.reply,
  onRangeChange,
}: {
  locationId: string
  /** The period, from `?range=`; the reply and Google presets share ids. */
  rangeId?: ReplyRangeId
  onRangeChange?: (range: ReplyRangeId) => void
}) {
  const directory = useLocationDirectory(useSessionRole())
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const business = useWorkspaceMode() === "business"
  const location = directory.data?.find((entry) => entry.id === locationId)
  const periodDates = formatPeriod(
    resolvedPeriod("reply", rangeId),
    "Europe/London"
  )

  if (directory.isPending) {
    return (
      <ReportsSkeleton variant="tab" label="Loading this location’s report" />
    )
  }

  // A failed directory is not "this location isn't yours".
  if (directory.isError) {
    return (
      <ReportingPanel
        variant="error"
        title="We couldn’t load this location"
        cause={directory.error}
        onRetry={() => void directory.refetch()}
      />
    )
  }

  if (!location) return <NotInDirectory kind="location" />

  const siblings = business
    ? (directory.data ?? [])
    : location.clientId
      ? (directory.data ?? []).filter(
          (entry) => entry.clientId === location.clientId
        )
      : []
  const periodLabel =
    REPLY_RANGES.find((option) => option.id === rangeId)?.label ?? ""
  const whose = business
    ? null
    : (location.clientName ?? "Not filed under a client")

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <div className="flex flex-col gap-3">
        {/* The scope, said once in words at every width: the summary button
            is phone-only and the meta line is desk-only. */}
        <p className="text-body text-ink">
          Reporting on <span className="font-semibold">{location.name}</span>
          {whose ? <span className="text-ink-muted"> · {whose}</span> : null}
        </p>
        <ReportToolbar
          summary={[location.name, periodLabel]}
          meta={periodDates}
          fields={(placement) => {
            const field = reportToolbarFieldProps(placement)
            return (
              <>
                <LocationSelect
                  {...field}
                  locations={siblings}
                  value={locationId}
                  onChange={(next) => {
                    const params = new URLSearchParams(searchParams.toString())
                    if (next) params.set("locationId", next)
                    else {
                      params.delete("locationId")
                      if (location.clientId && !business)
                        params.set("clientId", location.clientId)
                    }
                    router.replace(`${pathname}?${params.toString()}`, {
                      scroll: false,
                    })
                  }}
                />
                {onRangeChange ? (
                  <RangeSelect
                    {...field}
                    className={placement === "bar" ? "w-44" : field.className}
                    value={rangeId}
                    onChange={onRangeChange}
                    options={REPLY_RANGES}
                    period={placement === "sheet" ? periodDates : undefined}
                  />
                ) : null}
              </>
            )
          }}
          extras={
            <>
              <Link
                href={`/listings/${location.id}`}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Open listing
              </Link>
              <Link
                href={
                  location.clientId && !business
                    ? `/reports?clientId=${location.clientId}`
                    : "/reports"
                }
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                {business
                  ? "All locations"
                  : location.clientId
                    ? "Whole client"
                    : "All clients"}
              </Link>
            </>
          }
        />
      </div>
      {/* The period picker is the toolbar's, so none is drawn below. */}
      <LocationPerformance locationId={locationId} rangeId={rangeId} />
    </div>
  )
}

export { LocationReport }
