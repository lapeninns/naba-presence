"use client"

import { BarChart3Icon, ExternalLinkIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { LocationPerformance } from "@/components/performance/location-performance"
import { LocationSelect } from "@/components/performance/location-select"
import { RangeSelect } from "@/components/performance/range-select"
import { NotInDirectory } from "@/components/performance/report-scope"
import { ReportActionsMenu } from "@/components/reporting/report-actions-menu"
import {
  ReportPeriodStrip,
  ReportToolbar,
  reportToolbarFieldProps,
} from "@/components/reporting/report-toolbar"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { buttonVariants } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
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
 * `?locationId=`: the location (switching to its client's other locations,
 * in the app bar's scope chip on a phone and the Location field from `md`),
 * the period (`?range=`, owned by the page; a chip strip on a phone) and the
 * way back to the whole client (inline from `md`, in the actions menu on a
 * phone).
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

  // The figures start from `locationId` alone, in parallel with the
  // directory; only the name and the sibling picker wait for it.
  const figures = (
    <LocationPerformance locationId={locationId} rangeId={rangeId} />
  )

  if (directory.isPending) {
    return (
      <div
        className="flex flex-col gap-(--np-gap-section)"
        data-slot="location-report"
      >
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading this location’s report</span>
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-(--np-chip-h) w-full rounded-(--np-radius-pill) md:hidden" />
          <Skeleton className="hidden h-(--np-control-h) w-full rounded-(--np-radius-control) md:block" />
        </div>
        {figures}
      </div>
    )
  }

  // A failed directory is not "this location isn't yours": say so, and keep
  // the figures, which never needed it.
  if (directory.isError) {
    return (
      <div
        className="flex flex-col gap-(--np-gap-section)"
        data-slot="location-report"
      >
        <ReportingPanel
          variant="error"
          title="We couldn’t load this location"
          cause={directory.error}
          onRetry={() => void directory.refetch()}
        />
        {figures}
      </div>
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
  const openListingHref = `/listings/${location.id}`
  const wholeHref =
    location.clientId && !business
      ? `/reports?clientId=${location.clientId}`
      : "/reports"
  const wholeLabel = business
    ? "All locations"
    : location.clientId
      ? "Whole client"
      : "All clients"
  const whose = business
    ? null
    : (location.clientName ?? "Not filed under a client")

  return (
    <div
      className="flex flex-col gap-(--np-gap-section)"
      data-slot="location-report"
    >
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
          fields={() => {
            const field = reportToolbarFieldProps()
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
                    className="w-44"
                    value={rangeId}
                    onChange={onRangeChange}
                    options={REPLY_RANGES}
                  />
                ) : null}
              </>
            )
          }}
          extras={
            <>
              <Link
                href={openListingHref}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Open listing
              </Link>
              <Link
                href={wholeHref}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                {wholeLabel}
              </Link>
            </>
          }
        />
        {/* A phone: the period in one tap, and the two links in the menu. */}
        <div className="flex items-start gap-2 md:hidden">
          {onRangeChange ? (
            <ReportPeriodStrip
              className="min-w-0 flex-1 py-2"
              value={rangeId}
              options={REPLY_RANGES}
              onChange={(next) => onRangeChange(next as ReplyRangeId)}
            />
          ) : (
            <span className="flex-1" />
          )}
          <ReportActionsMenu>
            <DropdownMenuItem render={<Link href={openListingHref} />}>
              <ExternalLinkIcon aria-hidden strokeWidth={1.75} />
              Open listing
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={wholeHref} />}>
              <BarChart3Icon aria-hidden strokeWidth={1.75} />
              {wholeLabel}
            </DropdownMenuItem>
          </ReportActionsMenu>
        </div>
      </div>
      {/* The period picker is the toolbar's (or the strip's), so none is drawn below. */}
      {figures}
    </div>
  )
}

export { LocationReport }
