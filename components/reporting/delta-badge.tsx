import { Badge } from "@/components/ui/badge"
import { deltaDirection, formatDelta, type DeltaDirection } from "@/lib/format"

type DeltaUnit = "count" | "percent" | "rating" | "duration"

const GLYPH: Record<DeltaDirection, string> = { up: "▲", down: "▼", flat: "▬" }

// Screen-reader wording. A duration that went "down" is a shorter (faster)
// response time, so durations read faster/slower; everything else reads as a
// plain increase/decrease. No red/green anywhere — the arrow glyph + signed
// magnitude carry the direction (spec §8 "non-colour cues").
function directionWord(direction: DeltaDirection, unit: DeltaUnit): string {
  if (direction === "flat") return "no change"
  if (unit === "duration") return direction === "down" ? "faster" : "slower"
  return direction === "up" ? "increase" : "decrease"
}

export function DeltaBadge({
  current,
  previous,
  unit = "count",
}: {
  current: number | null
  previous: number | null
  unit?: DeltaUnit
}) {
  const direction = deltaDirection(current, previous)
  const text = formatDelta(current, previous, { unit })
  if (!direction || text === null) return null
  return (
    <Badge
      variant="outline"
      role="img"
      aria-label={`${directionWord(direction, unit)} ${text} versus the previous window`}
    >
      <span aria-hidden className="tabular-nums">
        {GLYPH[direction]} {text}
      </span>
    </Badge>
  )
}
