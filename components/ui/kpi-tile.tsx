import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

type KpiDeltaTone = "success" | "warning" | "danger" | "neutral"

type KpiDelta = {
  /** The movement, already formatted: "+12%", "−3", "0.2 pts". */
  value: React.ReactNode
  /**
   * Which way the figure moved. Picks the arrow and, unless `tone` overrides
   * it, the ink: up is success, down is danger, flat is neutral.
   */
  direction?: "up" | "down" | "flat"
  /**
   * Overrides the ink when the direction's default reading is wrong: a rise
   * in unanswered reviews is `danger` even though it is `up`.
   */
  tone?: KpiDeltaTone
  /** What the delta is against: "vs previous 30 days". */
  label?: React.ReactNode
}

type KpiTileProps = {
  label: string
  value: React.ReactNode
  /** One short line of context: the window, the target, the comparison. */
  hint?: React.ReactNode
  /** A delta badge, sparkline or similar, aligned with the label. */
  trailing?: React.ReactNode
  /** A movement row under the figure, in the status inks. */
  delta?: KpiDelta
  className?: string
}

const DELTA_TONE_CLASS: Record<KpiDeltaTone, string> = {
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-ink-muted",
}

const DIRECTION_DEFAULT_TONE: Record<
  NonNullable<KpiDelta["direction"]>,
  KpiDeltaTone
> = {
  up: "success",
  down: "danger",
  flat: "neutral",
}

const DIRECTION_WORD: Record<NonNullable<KpiDelta["direction"]>, string> = {
  up: "Up",
  down: "Down",
  flat: "No change",
}

/**
 * A single headline figure (reference `.stat`): a bordered white tile, the
 * label in muted UI text, the figure in 26px mono tabular numerals, and a
 * delta row whose direction is spoken as well as drawn. A missing figure is
 * "—" with the reason in `hint`; missing is not zero.
 *
 * The label is a `p`, never a heading: these appear in rows of four under a
 * page `h1`, and four `h2`s carrying "Average rating" would flood the heading
 * outline that the axe suite pins.
 *
 * The delta's direction is spoken as well as drawn, so colour and the arrow
 * are never the only signal.
 */
function KpiTile({
  label,
  value,
  hint,
  trailing,
  delta,
  className,
}: KpiTileProps) {
  const direction = delta?.direction
  const tone = delta?.tone ?? (direction ? DIRECTION_DEFAULT_TONE[direction] : "neutral")
  const Arrow =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : direction === "flat"
          ? Minus
          : null

  return (
    <div
      data-slot="kpi-tile"
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface p-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-ui font-medium text-ink-muted">{label}</p>
        {trailing}
      </div>
      <p className="font-mono text-[26px] leading-8 font-semibold tracking-[-0.02em] break-words text-ink tabular-nums">
        {value}
      </p>
      {delta ? (
        <p className="flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-mono text-caption font-semibold tabular-nums",
              DELTA_TONE_CLASS[tone]
            )}
          >
            {Arrow ? (
              <Arrow className="size-3.5" strokeWidth={2} aria-hidden />
            ) : null}
            {direction ? (
              <span className="sr-only">{DIRECTION_WORD[direction]} </span>
            ) : null}
            {delta.value}
          </span>
          {delta.label ? (
            <span className="text-ink-muted">{delta.label}</span>
          ) : null}
        </p>
      ) : null}
      {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
    </div>
  )
}

export { KpiTile, type KpiTileProps, type KpiDelta, type KpiDeltaTone }
