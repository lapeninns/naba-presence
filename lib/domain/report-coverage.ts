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
  /** When the last fetch succeeded; read only by {@link classifyLocationCoverage}. */
  lastSucceededAt?: Date | null
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

/**
 * The one state a location is in for a report. Every location in scope has
 * exactly one, so the counts of the states add up to the locations in scope.
 *
 * - `reporting`: has figures in the window, fetched recently, no failed refresh.
 * - `pending`: no figures yet and the first fetch has not finished.
 * - `unavailable`: the latest refresh failed (figures it has may stop early).
 * - `stale`: its figures end before the window, or its last fetch is old
 *   (a location with figures in the window is still in the totals).
 * - `no_data`: fetched, and Google had nothing to report.
 */
export const LOCATION_COVERAGE_STATUSES = [
  "reporting",
  "pending",
  "unavailable",
  "stale",
  "no_data",
] as const
export type LocationCoverageStatus = (typeof LOCATION_COVERAGE_STATUSES)[number]

export type LocationCoverageOptions = CoverageOptions & {
  /** A successful fetch before this instant counts as stale. */
  staleBefore: Date
}

export function classifyLocationCoverage(
  locations: readonly CoverageLocation[],
  checkpoints: readonly CoverageCheckpoint[],
  {
    windowStart,
    latestStored = new Map(),
    staleBefore,
  }: LocationCoverageOptions
): Array<{ id: string; status: LocationCoverageStatus }> {
  const byLocation = new Map(
    checkpoints.map((checkpoint) => [checkpoint.locationId, checkpoint])
  )
  return locations.map(({ id }) => {
    const checkpoint = byLocation.get(id)
    const status = checkpoint?.status ?? null
    const watermark = checkpoint?.watermark ?? latestStored.get(id) ?? null
    const fetchedAt = checkpoint?.lastSucceededAt ?? null
    const oldFetch = fetchedAt !== null && fetchedAt < staleBefore
    const covered = watermark !== null && watermark >= windowStart
    if (status === "failed") return { id, status: "unavailable" }
    if (covered) return { id, status: oldFetch ? "stale" : "reporting" }
    // Not covered: Google's figures end before the window, or there are none.
    if (watermark !== null) return { id, status: "stale" }
    // No figures at all. One fetched long ago is out of date, not empty; one
    // never fetched is waiting for its first (a `running` claim on a fetched
    // location does not make it a first fetch again).
    if (fetchedAt !== null)
      return { id, status: oldFetch ? "stale" : "no_data" }
    return {
      id,
      status:
        status === null || status === "pending" || status === "running"
          ? "pending"
          : "no_data",
    }
  })
}

/** How many locations are in each {@link LocationCoverageStatus}; the counts sum to `eligible`. */
export function countLocationCoverage(
  statuses: ReadonlyArray<{ status: LocationCoverageStatus }>
) {
  const counts: Record<LocationCoverageStatus, number> = {
    reporting: 0,
    pending: 0,
    unavailable: 0,
    stale: 0,
    no_data: 0,
  }
  for (const { status } of statuses) counts[status] += 1
  return {
    eligible: statuses.length,
    reporting: counts.reporting,
    unavailable: counts.unavailable,
    stale: counts.stale,
    pending: counts.pending,
    noData: counts.no_data,
  }
}
