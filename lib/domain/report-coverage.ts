import type {
  ReportCompleteness,
  ReportMissingReason,
} from "@/lib/contracts/analytics"

/**
 * Expected vs covered locations for a Google report (presence or keywords).
 *
 * Pure and client-safe. Each location's watermark is the last day (or
 * month) Google returned for it: `sync_checkpoint.last_metric_date` /
 * `last_keyword_month`, or the newest stored row when the checkpoint has
 * none. Watermarks only advance over persisted data and survive a failed
 * refresh, so the oldest covered watermark is the date every covered
 * location is complete through. A location is covered only when its
 * watermark falls inside the report window: one without a watermark, or
 * whose watermark ends before the window starts, adds nothing to the totals
 * and is named as missing rather than counted as zero.
 */
export type CoverageLocation = { id: string; name: string }

export type CoverageCheckpoint = {
  locationId: string
  /** sync_checkpoint.status; absent when the location has no checkpoint. */
  status: string | null
  watermark: string | null
}

export type CoverageOptions = {
  /**
   * First day of the report window (ISO `YYYY-MM-DD`; keywords pass the
   * first day of the first month). A watermark before it is out of window.
   */
  windowStart: string
  /** Newest stored date per location, used when a checkpoint has no watermark. */
  latestStored?: ReadonlyMap<string, string>
}

export function summariseReportCoverage(
  locations: readonly CoverageLocation[],
  checkpoints: readonly CoverageCheckpoint[],
  { windowStart, latestStored = new Map() }: CoverageOptions
): ReportCompleteness {
  const byLocation = new Map(
    checkpoints.map((checkpoint) => [checkpoint.locationId, checkpoint])
  )
  const missing: ReportCompleteness["missing"] = []
  const refreshFailed: ReportCompleteness["refreshFailed"] = []
  let completeThrough: string | null = null
  let covered = 0
  for (const location of locations) {
    const checkpoint = byLocation.get(location.id)
    const status = checkpoint?.status ?? null
    const watermark =
      checkpoint?.watermark ?? latestStored.get(location.id) ?? null
    if (!watermark || watermark < windowStart) {
      missing.push({
        id: location.id,
        name: location.name,
        reason: missingReason(status, Boolean(watermark)),
      })
      continue
    }
    covered += 1
    if (!completeThrough || watermark < completeThrough) {
      completeThrough = watermark
    }
    if (status === "failed") {
      refreshFailed.push({ id: location.id, name: location.name })
    }
  }
  return {
    state:
      covered === 0
        ? "none"
        : missing.length || refreshFailed.length
          ? "partial"
          : "complete",
    expected: locations.length,
    covered,
    completeThrough,
    missing,
    refreshFailed,
  }
}

function missingReason(
  status: string | null,
  /** The location has data, but all of it ends before the window starts. */
  beforeWindow: boolean
): ReportMissingReason {
  if (status === "failed") return "unavailable"
  if (beforeWindow) return "stale"
  if (status === null || status === "pending" || status === "running") {
    return "pending"
  }
  return "no_data"
}
