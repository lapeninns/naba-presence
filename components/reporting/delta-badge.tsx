import type { KpiDelta, KpiDeltaTone } from "@/components/ui/kpi-tile"
import { deltaDirection, formatDelta, type DeltaDirection } from "@/lib/format"
import { cn } from "@/lib/utils"

type DeltaUnit = "count" | "percent" | "rating" | "duration"

/**
 * Which way is good. A duration is the one unit where a fall is the win: a
 * shorter response time is faster. Everything else reads a rise as good.
 */
type DeltaPolarity = "higher-is-better" | "lower-is-better"

const GLYPH: Record<DeltaDirection, string> = { up: "▲", down: "▼", flat: "▬" }

const TONE_CLASS: Record<KpiDeltaTone, string> = {
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-ink-muted",
}

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

// Screen-reader wording. A duration that went "down" is a shorter (faster)
// response time, so durations read faster/slower; everything else reads as a
// plain increase/decrease. The arrow glyph and the signed magnitude carry the
// direction on their own; the status ink is a second cue, never the only one.
function directionWord(direction: DeltaDirection, unit: DeltaUnit): string {
  if (direction === "flat") return "no change"
  if (unit === "duration") return direction === "down" ? "faster" : "slower"
  return direction === "up" ? "increase" : "decrease"
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

/**
 * An inline delta: a small arrow glyph and the signed magnitude in the status
 * ink for its direction. For a stat tile prefer `kpiDelta` with `KpiTile`;
 * this is for a table cell or a caption where a full delta row is too much.
 */
export function DeltaBadge({
  current,
  previous,
  unit = "count",
  polarity = defaultPolarity(unit),
  className,
}: {
  current: number | null
  previous: number | null
  unit?: DeltaUnit
  polarity?: DeltaPolarity
  className?: string
}) {
  const direction = deltaDirection(current, previous)
  const text = formatDelta(current, previous, { unit })
  if (!direction || text === null) return null
  return (
    <span
      data-slot="delta-badge"
      data-direction={direction}
      role="img"
      aria-label={`${directionWord(direction, unit)} ${text} versus the previous window`}
      className={cn(
        "inline-flex items-center gap-1 text-caption font-medium whitespace-nowrap tabular-nums",
        TONE_CLASS[toneFor(direction, polarity)],
        className
      )}
    >
      <span aria-hidden>
        {GLYPH[direction]} {text}
      </span>
    </span>
  )
}
