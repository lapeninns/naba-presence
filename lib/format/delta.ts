import { formatDuration } from "./duration"
import { formatNumber } from "./number"

export type DeltaDirection = "up" | "down" | "flat"

export function deltaDirection(
  current: number | null,
  previous: number | null
): DeltaDirection | null {
  if (current === null || previous === null) return null
  if (current > previous) return "up"
  if (current < previous) return "down"
  return "flat"
}

// Signed magnitude for a prior-window comparison. Uses a real minus glyph
// (never a hyphen) and an explicit "±0" so the change is legible without
// relying on colour. Duration deltas render via formatDuration so a
// response-time change never leaks raw seconds (spec §7). Returns null when
// the comparison is undefined.
export function formatDelta(
  current: number | null,
  previous: number | null,
  opts: { unit?: "count" | "percent" | "rating" | "duration" } = {}
): string | null {
  if (current === null || previous === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "—"
  const unit = opts.unit ?? "count"
  const diff = current - previous
  // Duration deltas: a negative underlying value is clock skew, not a real change.
  if (unit === "duration" && (current < 0 || previous < 0)) return "—"
  if (diff === 0) return "±0"
  const sign = diff > 0 ? "+" : "−"
  const magnitude = Math.abs(diff)
  if (unit === "percent") return `${sign}${magnitude.toFixed(1)}%`
  if (unit === "rating") return `${sign}${magnitude.toFixed(1)}★`
  if (unit === "duration") return `${sign}${formatDuration(magnitude)}`
  return `${sign}${formatNumber(magnitude)}`
}
