/**
 * Presentation helpers for the reports' bar charts. Nothing here changes a
 * figure: bins are plain sums of the daily counts the presence endpoint
 * returns, so a week's bar is exactly the days inside it added up.
 */

export type BinUnit = "day" | "week" | "month"

export type Bin = {
  /** ISO date (or datetime) the bin starts on. */
  start: string
  values: Record<string, number | null>
}

const DAY_MS = 86_400_000

/** How finely to draw a daily series: a bar per day while that stays legible. */
export function binUnitFor(days: number): BinUnit {
  if (days <= 35) return "day"
  if (days <= 120) return "week"
  return "month"
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function binStart(dateIso: string, unit: BinUnit): string {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`)
  if (unit === "day") return isoDay(date)
  if (unit === "month") return `${dateIso.slice(0, 7)}-01`
  // Weeks start on Monday (en-GB).
  const offset = (date.getUTCDay() + 6) % 7
  return isoDay(new Date(date.getTime() - offset * DAY_MS))
}

/** Every calendar day from `from` to `to` inclusive (ISO dates). */
export function daysInWindow(from: string, to: string): string[] {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const days: string[] = []
  for (let t = start; t <= end; t += DAY_MS) days.push(isoDay(new Date(t)))
  return days
}

/**
 * Sum a daily series (`{ date, metrics }`) into bins of `unit`, for the
 * given keys. Each key is a list of metrics added together (Search views are
 * desktop + mobile search). A bin where none of a key's metrics were
 * reported is `null`, not zero.
 *
 * The presence endpoint only returns days Google reported, so pass the
 * report's `window` to lay out every day (or week, or month) in it: a day
 * with nothing reported becomes an empty (null) bar in its place on the time
 * axis, rather than the reported days closing up as if they were adjacent.
 */
export function binDailySeries(
  series: Array<{ date: string; metrics: Record<string, number> }>,
  keys: Record<string, readonly string[]>,
  unit: BinUnit,
  window?: { from: string; to: string }
): Bin[] {
  const bins = new Map<string, Bin>()
  const ensure = (start: string) => {
    let bin = bins.get(start)
    if (!bin) {
      bin = {
        start,
        values: Object.fromEntries(Object.keys(keys).map((k) => [k, null])),
      }
      bins.set(start, bin)
    }
    return bin
  }
  if (window) {
    for (const day of daysInWindow(window.from, window.to)) {
      ensure(binStart(day, unit))
    }
  }
  const ordered = [...series].sort((a, b) => a.date.localeCompare(b.date))
  for (const point of ordered) {
    const bin = ensure(binStart(point.date, unit))
    for (const [key, metrics] of Object.entries(keys)) {
      for (const metric of metrics) {
        const value = point.metrics[metric]
        if (typeof value === "number") {
          bin.values[key] = (bin.values[key] ?? 0) + value
        }
      }
    }
  }
  return [...bins.values()].sort((a, b) => a.start.localeCompare(b.start))
}

/** The label a bin carries on the axis, in the table and in its tooltip. */
export function formatBinLabel(
  iso: string,
  unit: BinUnit,
  timeZone: string
): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso)
  if (unit === "month") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      month: "short",
      year: "numeric",
    }).format(date)
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(date)
}

/** The first column's heading in a chart's screen-reader table. */
export const BIN_HEADING: Record<BinUnit, string> = {
  day: "Day",
  week: "Week starting",
  month: "Month",
}

/** "Daily totals." and friends, for a chart's caption. */
export const BIN_TOTALS_NOTE: Record<BinUnit, string> = {
  day: "Daily totals.",
  week: "Weekly totals.",
  month: "Monthly totals.",
}
