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
   * Which way the figure moved. Picks the arrow and the spoken word ("Up",
   * "Down", "No change"); it does not pick a colour. A fall is not bad by
   * itself (a shorter response time is the win), so the ink stays neutral
   * until the caller says which way is good through `tone`.
   */
  direction?: "up" | "down" | "flat"
  /**
   * The reading the caller knows: `success` when the move is good, `danger`
   * when it is bad (a rise in unanswered reviews is `danger` even though it
   * is `up`). Omitted, the delta is neutral ink. A flat delta is always
   * neutral. `kpiDelta` (components/reporting/delta-badge) sets it from the
   * unit's polarity.
   */
  tone?: KpiDeltaTone
  /** What the delta is against: "vs previous 30 days". */
  label?: React.ReactNode
}

type KpiTileProps = {
  label: string
  /**
   * The figure, already formatted. `"—"` (or nothing) is a missing figure:
   * drawn as a small grey dash, not a dash at figure size; give the reason
   * in `hint`. Missing is not zero.
   */
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

const DIRECTION_WORD: Record<NonNullable<KpiDelta["direction"]>, string> = {
  up: "Up",
  down: "Down",
  flat: "No change",
}

/** The figure a tile prints when it has none: "—", never 0. */
const MISSING_FIGURE = "—"

function isMissingFigure(value: React.ReactNode) {
  return value === null || value === undefined || value === MISSING_FIGURE
}

/*
 * A tile reads whether it sits in a `KpiStrip` from the strip's
 * `data-kpi-strip` attribute (the `in-data-kpi-strip:` variant), not from
 * React context: the tile renders in server components too (the design
 * system page), where context cannot be created. In a strip the tile drops
 * its own card (edge, radius, fill) and draws the strip's hairlines as its
 * top and left edges; the strip's inner grid is pulled up and left by 1px
 * under the strip's clip, so the first row's and first column's hairlines
 * fall under the strip's own border. That works however the cells wrap,
 * where `divide-x` only works on one row.
 */
const IN_STRIP_CLASS =
  "in-data-kpi-strip:rounded-none in-data-kpi-strip:border-t in-data-kpi-strip:border-l in-data-kpi-strip:border-r-0 in-data-kpi-strip:border-b-0 in-data-kpi-strip:border-line-subtle in-data-kpi-strip:bg-transparent"

/**
 * A single headline figure (reference `.stat`): the label in muted UI text
 * over the figure in the `figure` role (24px touch, 22px desk, one step under
 * the page h1) in tabular numerals, and a delta row whose direction is spoken
 * as well as drawn. A missing figure is a small grey "—" with the reason in
 * `hint`; missing is not zero.
 *
 * Figures are grouped, not boxed: a row of them belongs in one `KpiStrip`,
 * where each tile is a borderless cell between hairlines. A tile on its own
 * is still a bordered card. Either way it has an edge or a fill, never a
 * shadow on top of an edge: a linked or toggle tile's hover is the tertiary
 * fill (fine pointers only), its press the sunken surface.
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
 * The tile has no minimum width and the figure breaks rather than
 * overflowing (a 24px five-digit figure needs about 90px of the 150px a
 * 2-up cell has inside at 360). `size="compact"` steps the figure down to the
 * section size for a dense phone row.
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
  // Colour only where the caller said which way is good; flat is never
  // coloured, whatever the tone says.
  const tone: KpiDeltaTone =
    direction === "flat" ? "neutral" : (delta?.tone ?? "neutral")
  const Arrow =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : direction === "flat"
          ? Minus
          : null
  const compact = size === "compact"
  const missing = isMissingFigure(value)
  const interactive = Boolean(href || onPress)
  const trail =
    trailing ??
    (href ? (
      <ChevronRight
        aria-hidden
        strokeWidth={1.75}
        className="size-4 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) ease-out-strong motion-reduce:transition-none motion-safe:hover-fine:group-hover/kpi:translate-x-0.5"
      />
    ) : null)

  const classes = cn(
    "group/kpi flex min-w-0 flex-col rounded-(--np-radius-card) border border-line bg-surface text-left text-ink no-underline",
    compact ? "gap-0.5 p-3" : "gap-1 p-4",
    IN_STRIP_CLASS,
    // A standalone tile keeps the 4px halo outside its edge; in a strip the
    // strip clips its cells, so the ring is drawn inside the cell instead.
    interactive &&
      "cursor-pointer focus-halo transition-[background-color,border-color] duration-(--np-duration-fast) ease-out-strong focus-visible:outline-none active:bg-surface-alt in-data-kpi-strip:focus-ring-inset hover-fine:hover:bg-fill-tertiary",
    // Pressed is an ink edge, like a pressed chip: the accent is reserved for
    // the primary action and the current nav item. In a strip the cell's
    // hairlines stay put and the edge is a 2px inner ring.
    pressed &&
      "border-ink inset-ring inset-ring-ink in-data-kpi-strip:inset-ring-2",
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
            "block min-w-0 text-ink-muted",
            compact ? "text-caption" : "text-ui"
          )}
        >
          {label}
        </Line>
        {trail}
      </Row>
      {missing ? (
        // A small grey dash on the figure's line height, so a row's figures
        // and deltas stay aligned beside it.
        <Line
          data-missing=""
          className={cn(
            "block text-title text-ink-muted",
            compact
              ? "leading-(--np-text-section-lh)"
              : "leading-(--np-text-figure-lh)"
          )}
        >
          {MISSING_FIGURE}
        </Line>
      ) : (
        <Line
          className={cn(
            "block font-semibold break-words text-ink tabular-nums",
            compact ? "text-section tracking-[-0.02em]" : "text-figure"
          )}
        >
          {value}
        </Line>
      )}
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
      <Link
        href={href}
        data-slot="kpi-tile"
        data-size={size}
        className={classes}
      >
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

/*
 * Columns by count, against the strip's own width (`@container/kpi`), so the
 * strip lays out the same in a report column, the client hub and a dialog.
 * Two to a row below 40rem (a 320px phone included); from there as many as
 * fit without squeezing a figure, then all of them in one row once each cell
 * has about 11rem. Four go 2 then 4 (never 3 + 1); five go 2, 3, then 5.
 */
const STRIP_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @[40rem]/kpi:grid-cols-3",
  4: "grid-cols-2 @[48rem]/kpi:grid-cols-4",
  5: "grid-cols-2 @[40rem]/kpi:grid-cols-3 @[60rem]/kpi:grid-cols-5",
  6: "grid-cols-2 @[40rem]/kpi:grid-cols-3 @[66rem]/kpi:grid-cols-6",
}
const STRIP_COLUMNS_MANY =
  "grid-cols-2 @[40rem]/kpi:grid-cols-3 @[56rem]/kpi:grid-cols-4"

/** With an odd count, the last cell takes both phone columns: no orphan. */
const STRIP_ODD_LAST_CLASS = "@max-[40rem]/kpi:[&>:last-child]:col-span-2"

type KpiStripProps = React.ComponentProps<"div"> & {
  /** `KpiTile`s (or components that render one), one per cell. */
  children: React.ReactNode
}

/**
 * A row of headline figures as one container (Taste app-screens §5, "group,
 * don't box"): one card edge around all of them, the figures split by
 * hairlines, rather than a bordered card per figure.
 *
 *   <KpiStrip>
 *     <KpiTile label="Reviews" value="42" delta={…} />
 *     <KpiTile label="Response rate" value="96%" />
 *     <KpiTile label="Needs reply" value="5" href="/inbox?…" />
 *   </KpiStrip>
 *
 * Linked and toggle tiles stay whole-cell targets; their focus ring is drawn
 * inside the cell, since the strip clips to its radius. Other props go to
 * the outer element, so a caller can give it its own `data-slot` test hook.
 */
function KpiStrip({ children, className, ...props }: KpiStripProps) {
  const count = React.Children.toArray(children).filter(
    React.isValidElement
  ).length
  return (
    <div
      data-slot="kpi-strip"
      data-kpi-strip=""
      {...props}
      className={cn(
        "@container/kpi min-w-0 overflow-hidden rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
    >
      <div
        data-slot="kpi-strip-grid"
        className={cn(
          "-mt-px -ml-px grid",
          STRIP_COLUMNS[count] ?? STRIP_COLUMNS_MANY,
          count > 1 && count % 2 === 1 && STRIP_ODD_LAST_CLASS
        )}
      >
        {children}
      </div>
    </div>
  )
}

export {
  KpiStrip,
  KpiTile,
  type KpiStripProps,
  type KpiTileProps,
  type KpiDelta,
  type KpiDeltaTone,
}
