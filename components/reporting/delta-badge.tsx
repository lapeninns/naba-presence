import type { KpiDelta, KpiDeltaTone } from "@/components/ui/kpi-tile"
import { deltaDirection, formatDelta, type DeltaDirection } from "@/lib/format"

type DeltaUnit = "count" | "percent" | "rating" | "duration"

/**
 * Which way is good. A duration is the one unit where a fall is the win: a
 * shorter response time is faster. Everything else reads a rise as good.
 */
type DeltaPolarity = "higher-is-better" | "lower-is-better"

function defaultPolarity(unit: DeltaUnit): DeltaPolarity {
  return unit === "duration" ? "lower-is-better" : "higher-is-better"
}

function toneFor(
  direction: DeltaDirection,
  polarity: DeltaPolarity
): KpiDeltaTone {
  if (direction === "flat") return "neutral"
  const improved =
    polarity === "higher-is-better" ? direction === "up" : direction === "down"
  return improved ? "success" : "danger"
}

function comparisonLabel(direction: DeltaDirection, unit: DeltaUnit): string {
  if (unit === "duration") {
    if (direction === "flat") return "same as the previous window"
    return direction === "down"
      ? "faster than the previous window"
      : "slower than the previous window"
  }
  return "vs the previous window"
}

/**
 * The movement between two windows, shaped for `KpiTile`'s `delta` prop.
 * Undefined when the comparison is undefined (either side missing), so the
 * tile draws nothing rather than a made-up zero.
 */
export function kpiDelta(
  current: number | null,
  previous: number | null,
  unit: DeltaUnit = "count",
  polarity: DeltaPolarity = defaultPolarity(unit)
): KpiDelta | undefined {
  const direction = deltaDirection(current, previous)
  const text = formatDelta(current, previous, { unit })
  if (!direction || text === null) return undefined
  return {
    value: text,
    direction,
    tone: toneFor(direction, polarity),
    label: comparisonLabel(direction, unit),
  }
}
