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
 * location is complete through. A location without one is missing: it adds
 * nothing to the totals, and is named rather than counted as zero.
 */
export type CoverageLocation = { id: string; name: string }

export type CoverageCheckpoint = {
  locationId: string
  /** sync_checkpoint.status; absent when the location has no checkpoint. */
  status: string | null
  watermark: string | null
}

export function summariseReportCoverage(
  locations: readonly CoverageLocation[],
  checkpoints: readonly CoverageCheckpoint[],
  /** Newest stored date per location, used when a checkpoint has no watermark. */
  latestStored: ReadonlyMap<string, string> = new Map()
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
    const watermark =
      checkpoint?.watermark ?? latestStored.get(location.id) ?? null
    if (!watermark) {
      missing.push({
        id: location.id,
        name: location.name,
        reason: missingReason(checkpoint?.status ?? null),
      })
      continue
    }
    covered += 1
    if (!completeThrough || watermark < completeThrough) {
      completeThrough = watermark
    }
    if (checkpoint?.status === "failed") {
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

function missingReason(status: string | null): ReportMissingReason {
  if (status === "failed") return "unavailable"
  if (status === null || status === "pending" || status === "running") {
    return "pending"
  }
  return "no_data"
}

/** Totals for a report with no covered location: every figure missing, none zero. */
export function totalsForCoverage<T extends Record<string, number | null>>(
  totals: T,
  completeness: ReportCompleteness
): T {
  if (completeness.covered > 0) return totals
  return Object.fromEntries(Object.keys(totals).map((key) => [key, null])) as T
}
