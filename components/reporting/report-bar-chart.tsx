"use client"

import { TableIcon } from "lucide-react"
import * as React from "react"

import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartDataTable, ChartLegend } from "@/components/ui/chart"
import { csvFilename } from "@/lib/reporting/csv"
import { cn } from "@/lib/utils"

/**
 * The reports' bar chart (reference `.vchart`), drawn in the DOM rather than
 * SVG so it lays out with the page at any width.
 *
 * - Filled bars on the `chart-*` tokens; series are told apart by lightness
 *   (chart-1 dark, chart-2 light, chart-3 grey) and the legend names them
 *   whenever there is more than one.
 * - Figures are printed on the peak bar and the latest bar, each with its
 *   date ("2 on 14 Oct"), in tabular mono; every bar when there are seven or
 *   fewer. The latest is left to the readout when it would sit on the peak's
 *   label.
 * - The drawing is `aria-hidden`; the same figures are a visually hidden
 *   table inside the figure, so a screen reader gets every value. "Show
 *   values" puts that table on screen, for anyone who cannot hover a bar
 *   (a phone, a keyboard) to read its tooltip, and "Download CSV" saves it.
 *   The table and the CSV always carry every day, whatever is drawn.
 * - Grouped by default; `stacked` piles the series and labels the total.
 *   `kind="line"` draws one series as dots joined by a line (an average,
 *   which a bar misreads on days with nothing to average).
 * - A daily chart too dense for its width (under 12px a day) is drawn a
 *   week (7 days) at a time; nothing is averaged, only summed. Set
 *   `groupable={false}` for a series that cannot be added up.
 * - Each column has a minimum width. On a narrow screen with many columns
 *   the plot scrolls sideways inside its own box (focusable only while it
 *   actually overflows), never the page.
 * - Scrub to inspect: touching, dragging or hovering across the plot picks
 *   the column under the pointer and shows its period and every series'
 *   value in the readout line above the plot, so no bar is a tap target of
 *   its own and a phone never needs hover. The plot is one keyboard stop (a
 *   slider over the columns: arrows, Home, End), never a tab stop per bar;
 *   its value text is the readout, so a screen reader hears what the eye
 *   sees. With nothing picked the readout shows the latest column. Nothing
 *   animates.
 * - Computed geometry (bar heights, the plot's minimum width, label
 *   offsets) is passed as CSS custom properties and read by utilities.
 */

type ChartVars = React.CSSProperties & Record<`--${string}`, string>

type SlotColor = 1 | 2 | 3

export type ReportBarSeries = {
  key: string
  label: string
  color: SlotColor
}

export type ReportBarDatum = {
  /** Axis and table label: "3 Sep", "Aug 2026". */
  label: string
  values: Record<string, number | null>
}

const BAR_CLASS: Record<SlotColor, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
}

const LINE_CLASS: Record<SlotColor, string> = {
  1: "stroke-chart-1",
  2: "stroke-chart-2",
  3: "stroke-chart-3",
}

/** Below this many pixels a day, a daily chart is drawn a week at a time. */
const MIN_DAY_PX = 12
/** The axis column and its gap, beside the plot. */
const AXIS_PX = 48
const GROUP_SIZE = 7

/** What a printed figure says about its column: "2 on 14 Oct". */
const AT: Record<string, string> = {
  day: "on",
  week: "in week of",
  month: "in",
}

type Bar = ReportBarDatum & {
  /** The start of the period, for the printed figure's date. */
  short: string
}

/**
 * A daily series drawn seven days at a time, counted back from the latest
 * day so the newest bar is a full week. Values are summed; a group with
 * nothing reported stays empty rather than becoming 0.
 */
function groupDays(data: ReportBarDatum[], series: ReportBarSeries[]): Bar[] {
  const groups: Bar[] = []
  for (let end = data.length; end > 0; end -= GROUP_SIZE) {
    const chunk = data.slice(Math.max(0, end - GROUP_SIZE), end)
    const first = chunk[0]
    const last = chunk[chunk.length - 1]
    groups.unshift({
      label: chunk.length > 1 ? `${first.label} – ${last.label}` : first.label,
      short: first.label,
      values: Object.fromEntries(
        series.map((s) => {
          const reported = chunk
            .map((datum) => datum.values[s.key])
            .filter((v): v is number => typeof v === "number")
          return [
            s.key,
            reported.length ? reported.reduce((a, b) => a + b, 0) : null,
          ]
        })
      ),
    })
  }
  return groups
}

// The top of the scale: twice a round whole step, so the three
// gridline figures (0, half, top) are whole, round numbers.
function niceMax(value: number): number {
  const half = Math.max(1, value / 2)
  const power = Math.pow(10, Math.floor(Math.log10(half)))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
    .map((m) => m * power)
    .find((m) => Number.isInteger(m) && m >= half)!
  return step * 2
}

function useOverflowsX(ref: React.RefObject<HTMLElement | null>) {
  const [overflows, setOverflows] = React.useState(false)
  React.useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === "undefined") return
    const check = () => {
      const over = element.scrollWidth > element.clientWidth + 1
      setOverflows(over)
      // Open on the latest bars; earlier ones are a scroll to the left.
      if (over && element.scrollLeft === 0)
        element.scrollLeft = element.scrollWidth
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return overflows
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === "undefined") return
    const read = () => setWidth(element.clientWidth)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function ReportBarChart({
  title,
  categoryHeading,
  data,
  series,
  stacked = false,
  max: fixedMax,
  kind = "bars",
  groupable = true,
  format = (value) => new Intl.NumberFormat("en-GB").format(value),
  unitNote,
  unitName,
  csvName,
}: {
  /** Names the figures: the screen-reader table's caption. */
  title: string
  /** First column of the screen-reader table: "Day", "Week starting". */
  categoryHeading: string
  data: ReportBarDatum[]
  series: ReportBarSeries[]
  stacked?: boolean
  /** A fixed top of scale (5 for a star rating); otherwise a round number. */
  max?: number
  /** `line` draws the first series as dots joined by a line. */
  kind?: "bars" | "line"
  /** Whether a dense daily chart may be drawn a week at a time (sums). */
  groupable?: boolean
  format?: (value: number) => string
  /** "Daily totals." — the last sentence of the caption. */
  unitNote: string
  /** "day", "week", "month": names what the labelled bar is. */
  unitName: string
  /** Names the downloaded file; defaults to the title. */
  csvName?: string
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const columnRefs = React.useRef<Array<HTMLDivElement | null>>([])
  const scrubbing = React.useRef(false)
  const overflows = useOverflowsX(scrollRef)
  const width = useElementWidth(scrollRef)
  const [showValues, setShowValues] = React.useState(false)
  const [picked, setPicked] = React.useState<number | null>(null)
  const tableId = React.useId()
  const line = kind === "line"

  // A daily chart with too little room is drawn a week at a time.
  const grouped =
    groupable &&
    !line &&
    unitName === "day" &&
    data.length > GROUP_SIZE * 2 &&
    width > 0 &&
    (width - AXIS_PX) / data.length < MIN_DAY_PX
  const bars: Bar[] = grouped
    ? groupDays(data, series)
    : data.map((datum) => ({ ...datum, short: datum.label }))
  const unit = grouped ? "week" : unitName

  const columnTotal = (datum: ReportBarDatum) =>
    stacked
      ? series.reduce((sum, s) => sum + (datum.values[s.key] ?? 0), 0)
      : Math.max(0, ...series.map((s) => datum.values[s.key] ?? 0))
  const totals = bars.map(columnTotal)
  const top = fixedMax ?? niceMax(Math.max(1, ...totals))
  const peak = totals.indexOf(Math.max(...totals))
  const last = bars.length - 1
  const labelAll = bars.length <= 7
  // The printed figure: the total when stacked or single; otherwise the
  // first series (the one the chart is about: reviews received).
  // A column where nothing was reported prints nothing, never a made-up 0.
  const printed = (datum: ReportBarDatum, index: number): number | null =>
    stacked
      ? series.some((s) => typeof datum.values[s.key] === "number")
        ? totals[index]
        : null
      : (datum.values[series[0].key] ?? null)
  // Which columns carry a figure: all of a short chart; otherwise the
  // busiest (when it is not zero) and the latest, unless the latest would
  // sit on the busiest one's label (it stays in the readout).
  const apart = Math.abs(last - peak) >= Math.ceil(bars.length * 0.4)
  const labelled = (index: number) =>
    labelAll ||
    (index === peak && totals[peak] > 0) ||
    (index === last && (peak === last || totals[peak] <= 0 || apart))
  const minColumn =
    stacked || line || series.length === 1 ? 4 : 1 + series.length * 2
  const pct = (value: number) => `${Math.min(100, (value / top) * 100)}%`
  const middle = Math.floor(bars.length / 2)

  // A picked column that a new data set no longer has falls back to latest.
  const selected = picked !== null && picked <= last ? picked : null
  const active = selected ?? last
  const describe = (datum: ReportBarDatum) =>
    `${datum.label}: ${series
      .map((s) => {
        const v = datum.values[s.key]
        return `${s.label} ${v === null || v === undefined ? "—" : format(v)}`
      })
      .join(", ")}`
  const readout = active >= 0 ? describe(bars[active]) : ""

  const pick = (index: number, scroll = false) => {
    const next = Math.max(0, Math.min(last, index))
    setPicked(next)
    // Keep a keyboard-picked column in view inside the scroll box.
    if (scroll)
      columnRefs.current[next]?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
      })
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -7,
      PageUp: 7,
    }
    if (event.key === "Home") pick(0, true)
    else if (event.key === "End") pick(last, true)
    else if (event.key in step) pick(active + step[event.key], true)
    else return
    event.preventDefault()
  }
  // The column under the pointer: the whole plot is the target, so a 10px
  // bar is never a 10px tap.
  const columnAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !bars.length) return null
    return Math.floor(((event.clientX - rect.left) / rect.width) * bars.length)
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    const index = columnAt(event)
    if (index === null) return
    scrubbing.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pick(index)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // A touch or pen scrubs while down; a mouse follows the hover.
    if (!scrubbing.current && event.pointerType !== "mouse") return
    const index = columnAt(event)
    if (index !== null) pick(index)
  }
  const endScrub = () => {
    scrubbing.current = false
  }

  return (
    <figure
      data-slot="report-bar-chart"
      className="@container/chart m-0 flex min-w-0 flex-col gap-2.5"
    >
      {series.length > 1 ? (
        <div aria-hidden>
          <ChartLegend
            items={series.map((s) => ({ label: s.label, colorVar: s.color }))}
          />
        </div>
      ) : null}
      {/* The readout: what the eye gets from a tap. Hidden from assistive
          tech, which hears the same words as the slider's value. */}
      {bars.length ? (
        <p
          aria-hidden
          data-slot="report-bar-readout"
          className="min-h-5 text-caption text-ink tabular-nums"
        >
          {selected === null ? (
            <span className="text-ink-muted">Latest {unit} · </span>
          ) : null}
          {readout}
        </p>
      ) : null}
      <div
        ref={scrollRef}
        role={overflows ? "group" : undefined}
        aria-label={overflows ? `${title}, scrolls sideways` : undefined}
        tabIndex={overflows ? 0 : undefined}
        className="-m-1 min-w-0 overflow-x-auto overscroll-x-contain p-1 focus-halo"
      >
        <div
          className="grid min-w-(--chart-min-w) grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-5"
          style={
            {
              "--chart-min-w": `${AXIS_PX + bars.length * (minColumn + 1)}px`,
            } as ChartVars
          }
        >
          <div
            aria-hidden
            className="relative h-45 w-9 text-caption text-ink-muted tabular-nums"
          >
            {[0, 0.5, 1].map((fraction) => (
              <span
                key={fraction}
                className="absolute right-0 bottom-(--tick-y) translate-y-1/2 leading-none"
                style={{ "--tick-y": `${fraction * 100}%` } as ChartVars}
              >
                {format(top * fraction)}
              </span>
            ))}
          </div>
          <div
            role="slider"
            tabIndex={bars.length ? 0 : -1}
            aria-label={`${title}: pick a ${unit}`}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, last)}
            aria-valuenow={Math.max(0, active)}
            aria-valuetext={readout}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            className={cn(
              "relative flex h-45 cursor-pointer items-end gap-px rounded-sm border-b border-line-strong focus-halo outline-none @[30rem]/chart:gap-0.5",
              // Horizontal drags scrub; the page still scrolls up and down.
              // While the plot overflows, its box needs the sideways pan.
              !overflows && "touch-pan-y"
            )}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-line-subtle" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line-subtle" />
            {bars.map((datum, index) => {
              const show = labelled(index)
              const value = printed(datum, index)
              const ratio = (index + 0.5) / bars.length
              return (
                <div
                  key={`${datum.label}-${index}`}
                  ref={(element) => {
                    columnRefs.current[index] = element
                  }}
                  aria-hidden
                  data-selected={selected === index || undefined}
                  className={cn(
                    "group/col relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-sm data-selected:bg-fill",
                    stacked
                      ? "flex-col-reverse items-center justify-start"
                      : "gap-px"
                  )}
                >
                  {/* First in the DOM so the top bar stays `:last-child`. */}
                  {show && value !== null ? (
                    <span
                      className={cn(
                        "pointer-events-none absolute bottom-(--label-y) text-caption leading-none font-semibold whitespace-nowrap text-ink tabular-nums",
                        bars.length > 1 && ratio < 0.3
                          ? "left-0"
                          : bars.length > 1 && ratio > 0.7
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2"
                      )}
                      style={
                        {
                          "--label-y": `calc(${pct(totals[index])} + ${line ? 8 : 4}px)`,
                        } as ChartVars
                      }
                    >
                      {labelAll
                        ? format(value)
                        : `${format(value)} ${AT[unit]} ${datum.short}`}
                    </span>
                  ) : null}
                  {series.map((s) => {
                    const v = datum.values[s.key]
                    if (v === null || v === undefined) {
                      return stacked || line ? null : (
                        <span key={s.key} className="max-w-5.5 flex-1" />
                      )
                    }
                    if (line) {
                      return (
                        <span
                          key={s.key}
                          className={cn(
                            BAR_CLASS[s.color],
                            "absolute bottom-(--bar-h) left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full"
                          )}
                          style={{ "--bar-h": pct(v) } as ChartVars}
                        />
                      )
                    }
                    return (
                      <span
                        key={s.key}
                        className={cn(
                          BAR_CLASS[s.color],
                          "h-(--bar-h) group-hover/col:brightness-95",
                          stacked
                            ? "w-full max-w-7.5 shrink-0 last:rounded-t-sm"
                            : "min-h-px max-w-5.5 flex-1 rounded-t-sm"
                        )}
                        style={{ "--bar-h": pct(v) } as ChartVars}
                      />
                    )
                  })}
                </div>
              )
            })}
            {line ? (
              <svg
                aria-hidden
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full overflow-visible"
              >
                <polyline
                  vectorEffect="non-scaling-stroke"
                  className={cn(
                    "fill-none stroke-2",
                    LINE_CLASS[series[0].color]
                  )}
                  points={bars
                    .map((datum, index) => {
                      const v = datum.values[series[0].key]
                      return typeof v === "number"
                        ? `${((index + 0.5) / bars.length) * 100},${100 - Math.min(100, (v / top) * 100)}`
                        : null
                    })
                    .filter((point) => point !== null)
                    .join(" ")}
                />
              </svg>
            ) : null}
          </div>
          <div
            aria-hidden
            className="col-start-2 mt-1.5 flex justify-between gap-2 text-caption text-ink-muted tabular-nums"
          >
            <span>{bars[0]?.short}</span>
            {bars.length > 2 ? (
              <span className="@max-[22rem]/chart:hidden">
                {bars[middle]?.short}
              </span>
            ) : null}
            {bars.length > 1 ? <span>{bars[last]?.short}</span> : null}
          </div>
        </div>
      </div>
      {/* The table is `sr-only`, but a table grows to fit its columns, and an
          absolutely positioned one still widens the page: at 320px a
          four-column table pushed the document to 359px. A clipping sr-only
          box around it keeps it out of the page's scroll width. */}
      <div
        id={tableId}
        className={showValues ? "max-h-72 min-w-0 overflow-auto" : "sr-only"}
      >
        <ChartDataTable
          caption={title}
          visible={showValues}
          columns={[categoryHeading, ...series.map((s) => s.label)]}
          rows={data.map((datum) => [
            datum.label,
            ...series.map((s) => {
              const v = datum.values[s.key]
              return v === null || v === undefined ? "—" : format(v)
            }),
          ])}
          // Figures are mono in their own cells (ChartDataTable); the dates
          // and headings stay sans with tabular numerals (D1).
          className="tabular-nums"
        />
      </div>
      <figcaption className="text-caption text-ink-muted">
        {stacked ? "Bar height is the total. " : null}
        {line
          ? `Each dot is a ${unit} with a rating; the highest and the latest are labelled where they fit.`
          : labelAll
            ? "Every bar is labelled."
            : `The busiest and the latest ${unit} are labelled where they fit.`}{" "}
        Drag or hover across the chart for its figures. {unitNote}
        {grouped
          ? " Drawn a week at a time on a narrow screen; the table and CSV have every day."
          : null}
      </figcaption>
      {/* 8px between wrapped rows: each small button's touch overhang (4px
          above and below its 36px) stays its own, so a narrow phone that
          stacks them keeps both at 44px. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showValues}
          aria-controls={tableId}
          onClick={() => setShowValues((shown) => !shown)}
        >
          <TableIcon aria-hidden strokeWidth={1.75} />
          {showValues ? "Hide values" : "Show values"}
        </Button>
        <CsvDownloadButton
          filename={csvFilename(csvName ?? title)}
          accessibleLabel={`Download ${title} as CSV`}
          rows={() => [
            [categoryHeading, ...series.map((s) => s.label)],
            ...data.map((datum) => [
              datum.label,
              ...series.map((s) => datum.values[s.key] ?? null),
            ]),
          ]}
        />
      </div>
    </figure>
  )
}

/**
 * A chart's card (reference `.card` + `.chart-foot`): the title as an `h3`,
 * an optional note on the right, then the chart.
 */
export function ReportChartCard({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card
      data-slot="report-chart-card"
      className={cn("break-inside-avoid", className)}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside ? <CardAction>{aside}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {children}
      </CardContent>
    </Card>
  )
}
