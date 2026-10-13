import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { COUNT_TEXT_CLASS } from "@/components/ui/count-text"
import { toneClasses } from "@/lib/ui/status-tone"
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
  /**
   * `compact` is the phone-row tile: a smaller figure and tighter padding,
   * so two sit side by side at 360px (and four fit in one screen) without
   * the figure wrapping. `default` is the report headline tile.
   */
  size?: "default" | "compact"
  /**
   * Makes the whole tile one link (a deep link into the filtered list it
   * counts). Its name starts with the visible label, and a chevron is drawn
   * unless `trailing` is given.
   */
  href?: string
  /**
   * Makes the whole tile a toggle button (a filter: "show only the 5 that
   * need a reply"). Reports `pressed` through `aria-pressed`. Ignored when
   * `href` is set.
   */
  onPress?: () => void
  /** The toggle's state; draws the tile pressed (an ink edge). */
  pressed?: boolean
  className?: string
}

// The delta inks read the five status tones, so "danger" here and "at-risk"
// on a pill are one colour.
const DELTA_TONE_CLASS: Record<KpiDeltaTone, string> = {
  success: toneClasses("success").text,
  warning: toneClasses("warning").text,
  danger: toneClasses("danger").text,
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
 * label in muted UI text, the figure in large mono tabular numerals, and a
 * delta row whose direction is spoken as well as drawn. A missing figure is
 * "—" with the reason in `hint`; missing is not zero.
 *
 * The label is a `p`, never a heading: these appear in rows of four under a
 * page `h1`, and four `h2`s carrying "Average rating" would flood the heading
 * outline that the axe suite pins.
 *
 * Three forms, one look:
 *
 *   <KpiTile label="Average rating" value="4.6" />          a figure
 *   <KpiTile label="Needs reply" value="5" href="/inbox?…" /> a deep link
 *   <KpiTile label="Paused" value="2" onPress={…} pressed />   a filter toggle
 *
 * Two to a row from 320px: the tile has no minimum width and the figure
 * breaks rather than overflowing (a 26px five-digit figure needs about 95px
 * of the 120px a 2-up tile has inside at 360). `size="compact"` steps the
 * figure down to the section size for a dense phone row. Give the grid
 * `grid-cols-2` from the narrowest phone (reporting's
 * `reportTileGridClassName` does); never a container breakpoint above
 * 17.5rem, which is the 2-up floor at 320px.
 */
function KpiTile({
  label,
  value,
  hint,
  trailing,
  delta,
  size = "default",
  href,
  onPress,
  pressed,
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
  const compact = size === "compact"
  const interactive = Boolean(href || onPress)
  const trail =
    trailing ??
    (href ? (
      <ChevronRight
        aria-hidden
        strokeWidth={1.75}
        className="size-4 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) hover-fine:group-hover/kpi:translate-x-0.5"
      />
    ) : null)

  const classes = cn(
    "group/kpi flex min-w-0 flex-col rounded-(--np-radius-card) border border-line bg-surface text-left text-ink no-underline",
    compact ? "gap-0.5 p-3" : "gap-1 p-4",
    interactive &&
      "cursor-pointer focus-halo transition-[background-color,border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy hover-fine:hover:border-line-strong hover-fine:hover:shadow-np-raised active:bg-surface-alt focus-visible:outline-none",
    // Pressed is an ink edge, like a pressed chip: the accent is reserved for
    // the primary action and the current nav item.
    pressed && "border-ink inset-ring inset-ring-ink",
    className
  )

  // Inside a link or button only phrasing content is allowed, so the lines
  // are spans there; a static tile keeps a `p` per line, which reads as
  // separate sentences in a screen reader's paragraph navigation.
  const Line = interactive ? "span" : "p"
  const Row = interactive ? "span" : "div"

  const body = (
    <>
      <Row className="flex items-start justify-between gap-2">
        <Line
          className={cn(
            "block min-w-0 font-medium text-ink-muted",
            compact ? "text-caption" : "text-ui"
          )}
        >
          {label}
        </Line>
        {trail}
      </Row>
      <Line
        className={cn(
          "block font-mono font-semibold tracking-[-0.02em] break-words text-ink tabular-nums",
          compact ? "text-section" : "text-page-title"
        )}
      >
        {value}
      </Line>
      {delta ? (
        <Line className="flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-semibold",
              COUNT_TEXT_CLASS,
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
        </Line>
      ) : null}
      {hint ? (
        <Line className="block text-caption text-ink-muted">{hint}</Line>
      ) : null}
    </>
  )

  if (href) {
    return (
      <Link href={href} data-slot="kpi-tile" data-size={size} className={classes}>
        {body}
      </Link>
    )
  }
  if (onPress) {
    return (
      <button
        type="button"
        data-slot="kpi-tile"
        data-size={size}
        aria-pressed={pressed ?? false}
        onClick={onPress}
        className={classes}
      >
        {body}
      </button>
    )
  }
  return (
    <div data-slot="kpi-tile" data-size={size} className={classes}>
      {body}
    </div>
  )
}

export { KpiTile, type KpiTileProps, type KpiDelta, type KpiDeltaTone }
