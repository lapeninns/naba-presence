"use client"

import { RefreshCw } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"

/** What the header needs to draw an editor's freshness line. */
export type GoogleFreshnessReport = {
  observedAt: string
  refreshing: boolean
  failed: boolean
  disabled: boolean
  refresh: () => void
}

type FreshnessSetter = (report: GoogleFreshnessReport | null) => void

// Two contexts: editors only need the stable setter, so a new report never
// re-renders (and re-reports from) the editor that sent it.
const FreshnessSetterContext = React.createContext<FreshnessSetter | null>(null)
const FreshnessReportContext =
  React.createContext<GoogleFreshnessReport | null>(null)

/**
 * Lets a listing area's header draw the editor's "Checked with Google" line
 * (L03): inside this provider `GoogleFreshness` reports instead of taking a
 * row of its own above the editor. Outside it, it renders inline as before.
 */
function GoogleFreshnessSlot({ children }: { children: React.ReactNode }) {
  const [report, setReport] = React.useState<GoogleFreshnessReport | null>(null)
  return (
    <FreshnessSetterContext.Provider value={setReport}>
      <FreshnessReportContext.Provider value={report}>
        {children}
      </FreshnessReportContext.Provider>
    </FreshnessSetterContext.Provider>
  )
}

/** The editor's freshness, for the header; null when none was reported. */
function useGoogleFreshnessReport(): GoogleFreshnessReport | null {
  return React.useContext(FreshnessReportContext)
}

/**
 * "Checked with Google 3 min ago. Check Google now", as one line. The
 * failure note is separate (`GoogleFreshnessFailure`) so a header can place
 * it where it shows at every width.
 */
function GoogleFreshnessLine({
  report,
  className,
}: {
  report: GoogleFreshnessReport
  className?: string
}) {
  const relative = formatRelativeTime(report.observedAt)
  return (
    <span
      data-slot="google-freshness"
      className={cn("inline-flex flex-wrap items-center gap-x-2", className)}
    >
      <span>
        Checked with Google{" "}
        {/* Relative to the reader's clock, so the server's render may differ. */}
        <time dateTime={report.observedAt} suppressHydrationWarning>
          {relative === "Just now" ? "just now" : relative}
        </time>
        .
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        disabled={report.disabled || report.refreshing}
        onClick={report.refresh}
      >
        <RefreshCw
          className={report.refreshing ? "size-3.5 animate-spin" : "size-3.5"}
          strokeWidth={1.75}
          aria-hidden
        />
        {report.refreshing ? "Checking Google…" : "Check Google now"}
      </Button>
    </span>
  )
}

/** Shown only while the last "Check Google now" failed. */
function GoogleFreshnessFailure({
  report,
  className,
}: {
  report: GoogleFreshnessReport | null
  className?: string
}) {
  if (!report?.failed || report.refreshing) return null
  return (
    <span role="status" className={cn("text-ink", className)}>
      Google couldn’t be checked just now. Try again.
    </span>
  )
}

/**
 * When the editor last saw Google, with "Check Google now" (W3-2). Within
 * the staleness budget an editor is served from its last Google read, so the
 * comparison can be a few minutes old; publishing still reads Google first.
 * Renders nothing for a payload without `observedAt`, and nothing inside a
 * `GoogleFreshnessSlot`, whose header draws it instead.
 */
export function GoogleFreshness({
  observedAt,
  onRefresh,
  refreshing,
  failed,
  disabled,
}: {
  observedAt: string | undefined
  onRefresh: () => void
  refreshing: boolean
  /** The last "Check Google now" failed; what shows is the earlier check. */
  failed?: boolean
  disabled?: boolean
}) {
  const setReport = React.useContext(FreshnessSetterContext)
  // The latest handler, behind a stable function, so a new closure on each
  // render never re-reports.
  const onRefreshRef = React.useRef(onRefresh)
  React.useEffect(() => {
    onRefreshRef.current = onRefresh
  })
  const refresh = React.useCallback(() => onRefreshRef.current(), [])

  React.useEffect(() => {
    if (!setReport) return
    setReport(
      observedAt
        ? {
            observedAt,
            refreshing,
            failed: Boolean(failed),
            disabled: Boolean(disabled),
            refresh,
          }
        : null
    )
  }, [setReport, observedAt, refreshing, failed, disabled, refresh])
  React.useEffect(() => {
    if (!setReport) return
    return () => setReport(null)
  }, [setReport])

  if (setReport || !observedAt) return null
  const report: GoogleFreshnessReport = {
    observedAt,
    refreshing,
    failed: Boolean(failed),
    disabled: Boolean(disabled),
    refresh,
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-ink-secondary">
      <GoogleFreshnessLine report={report} />
      <GoogleFreshnessFailure report={report} />
    </p>
  )
}

export {
  GoogleFreshnessFailure,
  GoogleFreshnessLine,
  GoogleFreshnessSlot,
  useGoogleFreshnessReport,
}
