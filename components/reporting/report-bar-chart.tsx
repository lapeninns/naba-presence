"use client"

import { TableIcon } from "lucide-react"
import * as React from "react"

import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import { Button } from "@/components/ui/button"
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
 * - Figures are printed on the peak bar and the latest bar (every bar when
 *   there are seven or fewer), in tabular mono.
 * - The drawing is `aria-hidden`; the same figures are a visually hidden
 *   table inside the figure, so a screen reader gets every value. "Show
 *   values" puts that table on screen, for anyone who cannot hover a bar
 *   (a phone, a keyboard) to read its tooltip, and "Download CSV" saves it.
 * - Grouped by default; `stacked` piles the series and labels the total.
 * - Each column has a minimum width. On a narrow screen with many columns
 *   the plot scrolls sideways inside its own box (focusable only while it
 *   actually overflows), never the page.
 */

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

export function ReportBarChart({
  title,
  categoryHeading,
  data,
  series,
  stacked = false,
  max: fixedMax,
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
  format?: (value: number) => string
  /** "Daily totals." — the last sentence of the caption. */
  unitNote: string
  /** "day", "week", "month": names what the labelled bar is. */
  unitName: string
  /** Names the downloaded file; defaults to the title. */
  csvName?: string
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const overflows = useOverflowsX(scrollRef)
  const [showValues, setShowValues] = React.useState(false)
  const tableId = React.useId()

  const columnTotal = (datum: ReportBarDatum) =>
    stacked
      ? series.reduce((sum, s) => sum + (datum.values[s.key] ?? 0), 0)
      : Math.max(0, ...series.map((s) => datum.values[s.key] ?? 0))
  const totals = data.map(columnTotal)
  const top = fixedMax ?? niceMax(Math.max(1, ...totals))
  const peak = totals.indexOf(Math.max(...totals))
  const last = data.length - 1
  const labelAll = data.length <= 7
  // The printed figure: the total when stacked or single; otherwise the
  // first series (the one the chart is about: reviews received).
  // A column where nothing was reported prints nothing, never a made-up 0.
  const printed = (datum: ReportBarDatum, index: number): number | null =>
    stacked
      ? series.some((s) => typeof datum.values[s.key] === "number")
        ? totals[index]
        : null
      : (datum.values[series[0].key] ?? null)
  const minColumn = stacked || series.length === 1 ? 4 : 1 + series.length * 2
  const pct = (value: number) => `${Math.min(100, (value / top) * 100)}%`
  const middle = Math.floor(data.length / 2)

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
      <div
        ref={scrollRef}
        role={overflows ? "group" : undefined}
        aria-label={overflows ? `${title}, scrolls sideways` : undefined}
        tabIndex={overflows ? 0 : undefined}
        className="min-w-0 overflow-x-auto overscroll-x-contain focus-halo"
      >
        <div
          aria-hidden
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-5"
          style={{ minWidth: `${48 + data.length * (minColumn + 1)}px` }}
        >
          <div className="relative h-45 w-9 font-mono text-[11px] text-ink-muted tabular-nums">
            {[0, 0.5, 1].map((fraction) => (
              <span
                key={fraction}
                className="absolute right-0 translate-y-1/2 leading-none"
                style={{ bottom: `${fraction * 100}%` }}
              >
                {format(top * fraction)}
              </span>
            ))}
          </div>
          <div className="relative flex h-45 items-end gap-px border-b border-line-strong @[30rem]/chart:gap-0.5">
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-line" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" />
            {data.map((datum, index) => {
              const show = labelAll || index === peak || index === last
              const value = printed(datum, index)
              const tip = `${datum.label}: ${series
                .map((s) => {
                  const v = datum.values[s.key]
                  return `${s.label} ${v === null || v === undefined ? "—" : format(v)}`
                })
                .join(", ")}`
              return (
                <div
                  key={`${datum.label}-${index}`}
                  title={tip}
                  className={cn(
                    "group/col relative flex h-full min-w-0 flex-1 items-end justify-center",
                    stacked
                      ? "flex-col-reverse items-center justify-start"
                      : "gap-px"
                  )}
                >
                  {/* First in the DOM so the top bar stays `:last-child`. */}
                  {show && value !== null ? (
                    <span
                      className={cn(
                        "pointer-events-none absolute font-mono text-[11px] leading-none font-semibold whitespace-nowrap text-ink tabular-nums",
                        index === last && data.length > 1
                          ? "right-0"
                          : index === 0 && data.length > 1
                            ? "left-0"
                            : "left-1/2 -translate-x-1/2"
                      )}
                      style={{
                        bottom: `calc(${pct(totals[index])} + 4px)`,
                      }}
                    >
                      {format(value)}
                    </span>
                  ) : null}
                  {series.map((s) => {
                    const v = datum.values[s.key]
                    if (v === null || v === undefined) {
                      return stacked ? null : (
                        <span key={s.key} className="max-w-5.5 flex-1" />
                      )
                    }
                    return (
                      <span
                        key={s.key}
                        className={cn(
                          BAR_CLASS[s.color],
                          "group-hover/col:brightness-95",
                          stacked
                            ? "w-full max-w-7.5 shrink-0 last:rounded-t-[2px]"
                            : "min-h-px max-w-5.5 flex-1 rounded-t-[2px]"
                        )}
                        style={{ height: pct(v) }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="col-start-2 mt-1.5 flex justify-between gap-2 font-mono text-[11px] text-ink-muted tabular-nums">
            <span>{data[0]?.label}</span>
            {data.length > 2 ? (
              <span className="@max-[22rem]/chart:hidden">
                {data[middle]?.label}
              </span>
            ) : null}
            {data.length > 1 ? <span>{data[last]?.label}</span> : null}
          </div>
        </div>
      </div>
      {/* The table is `sr-only`, but a table grows to fit its columns, and an
          absolutely positioned one still widens the page: at 320px a
          four-column table pushed the document to 359px. A clipping sr-only
          box around it keeps it out of the page's scroll width. */}
      <div
        id={tableId}
        className={
          showValues ? "max-h-72 min-w-0 overflow-auto" : "sr-only"
        }
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
          className="font-mono tabular-nums"
        />
      </div>
      <figcaption className="text-caption text-ink-muted">
        {stacked
          ? `Bar height is the total; ${labelAll ? "every bar is labelled." : `the busiest and the latest ${unitName} are labelled.`}`
          : labelAll
            ? "Every bar is labelled."
            : `The busiest and the latest ${unitName} are labelled.`}{" "}
        {unitNote}
      </figcaption>
      <div className="flex flex-wrap items-center gap-1">
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
    <section
      data-slot="report-chart-card"
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)",
        className
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}
