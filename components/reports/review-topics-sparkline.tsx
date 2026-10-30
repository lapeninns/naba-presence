import type * as React from "react"

type BarVars = React.CSSProperties & Record<`--${string}`, string>

const pct = (part: number, whole: number) =>
  whole <= 0 ? "0%" : `${Math.round((part / whole) * 100)}%`

/**
 * One topic's mentions per week, oldest first, as small bars: the negative
 * part of each week sits at its foot in the danger colour, against a
 * neutral bar for the rest (a green one would read as "positive" and is too
 * close in lightness to the red). Drawn for the
 * eye only; the label carries the same figures in words, so a screen reader
 * (and a phone, which cannot hover) gets them all.
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
          <span
            className="flex h-(--bar-h) flex-col justify-end bg-line-strong"
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
        </span>
      ))}
    </span>
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
