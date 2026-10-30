import type * as React from "react"

import { cn } from "@/lib/utils"

type BarVars = React.CSSProperties & Record<`--${string}`, string>

const pct = (part: number, whole: number) =>
  whole <= 0 ? "0%" : `${Math.round((part / whole) * 100)}%`

/**
 * One topic's mentions per week, oldest first, as small bars. Each week is
 * an outlined bar as tall as its mentions, filled solid from the foot for
 * the negative ones: hollow against solid, so the split reads without the
 * colour (the fill is also the danger colour, against a neutral outline; a
 * green would read as "positive" and is too close in lightness to the red).
 * `ReviewTopicsSparklineLegend` says so in words beside the table. Drawn
 * for the eye only; the label carries the same figures in words, so a
 * screen reader (and a phone, which cannot hover) gets them all.
 */
export function ReviewTopicsSparkline({
  weekly,
  weeklyNegative,
  label,
}: {
  weekly: number[]
  weeklyNegative: number[]
  label: string
}) {
  const max = Math.max(1, ...weekly)
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-6 items-end gap-0.5 align-middle"
    >
      {weekly.map((mentions, index) => (
        <span
          key={index}
          className="flex h-full w-1.5 flex-col justify-end border-b border-line"
        >
          {mentions > 0 ? (
            <span
              className="flex h-(--bar-h) min-h-1 flex-col justify-end overflow-hidden rounded-sm border border-ink-muted"
              style={{ "--bar-h": pct(mentions, max) } as BarVars}
            >
              <span
                className="h-(--neg-h) bg-danger-solid"
                style={
                  {
                    "--neg-h": pct(weeklyNegative[index] ?? 0, mentions),
                  } as BarVars
                }
              />
            </span>
          ) : null}
        </span>
      ))}
    </span>
  )
}

/** The sparkline's key in words: which part of a bar is which. */
export function ReviewTopicsSparklineLegend({
  className,
}: {
  className?: string
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted",
        className
      )}
    >
      <span>Each week’s bar:</span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-sm border border-ink-muted"
        />
        Other mentions
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-sm border border-ink-muted bg-danger-solid"
        />
        Negative mentions (solid)
      </span>
    </p>
  )
}

/** The sparkline's figures in words, oldest week first. */
export function sparklineLabel(
  weekly: number[],
  weeklyNegative: number[]
): string {
  const weeks = weekly
    .map((mentions, index) => {
      const negative = weeklyNegative[index] ?? 0
      return negative > 0 ? `${mentions} (${negative} negative)` : `${mentions}`
    })
    .join(", ")
  return `Mentions per week over the last ${weekly.length} weeks, oldest first: ${weeks}`
}
