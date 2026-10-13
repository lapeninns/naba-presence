"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type ColorVar = 1 | 2 | 3 | 4 | 5 | 6
type Series = { key: string; label: string; colorVar: ColorVar }

/** The measured chart hue for a series slot, as a CSS variable reference. */
function chartColor(colorVar: ColorVar): string {
  return `var(--np-chart-${colorVar})`
}

// Spelled out so Tailwind sees every class.
const SWATCH_CLASS: Record<ColorVar, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
}

/**
 * The series key (reference `.legend`): a 10px rounded-square swatch per
 * series and its name. Series separate by lightness first (chart-1 dark
 * green, chart-2 light green, chart-3 grey baseline), and the legend always
 * names them, so hue is never the only cue.
 *
 * `value` prints the series' figure for the picked (or latest) point beside
 * its name. A phone has no hover, so a chart whose figures only appear in a
 * hover tooltip hides them from a thumb: put them in the legend instead and
 * update them when a bar or point is tapped (report-bar-chart.tsx does the
 * same with its readout line).
 */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ label: string; colorVar: ColorVar; value?: React.ReactNode }>
  className?: string
}) {
  return (
    <ul
      data-slot="chart-legend"
      className={cn("flex flex-wrap gap-x-3.5 gap-y-1", className)}
    >
      {items.map((item) => (
        <li
          key={item.label}
          className="flex min-w-0 items-center gap-1.5 text-caption text-ink-muted"
        >
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-[3px]",
              SWATCH_CLASS[item.colorVar]
            )}
          />
          {item.label}
          {item.value !== undefined && item.value !== null ? (
            <span className="font-mono font-semibold text-ink tabular-nums">
              {item.value}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * The accessible alternative to a chart: the same figures as a table.
 * Visually hidden by default (the chart carries `aria-hidden` or a short
 * label); `visible` shows it as a compact table for a "Show values"
 * toggle, which is also how a touch user reads every figure without hover.
 * Figures are mono tabular and right-aligned. A visible table with many
 * series can be wider than a phone: wrap it in a box with `overflow-x-auto`
 * (report-bar-chart.tsx does) rather than letting it widen the page.
 *
 * The product's charts are drawn by hand in components/reporting (CSS bars,
 * a slider for keyboard and tap picking); the recharts wrappers that used
 * to live here had no importer and were removed.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
  visible = false,
  className,
}: {
  caption: string
  /** First column is the category (the date); the rest are series. */
  columns: string[]
  rows: Array<Array<React.ReactNode>>
  visible?: boolean
  className?: string
}) {
  return (
    <table
      data-slot="chart-data-table"
      className={cn(
        visible
          ? "w-full border-collapse text-ui [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-alt [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-caption [&_th]:font-semibold [&_th]:text-ink-muted"
          : "sr-only",
        className
      )}
    >
      <caption className={visible ? "sr-only" : undefined}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={index > 0 ? "text-right!" : undefined}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="font-normal">
                  {cell}
                </th>
              ) : (
                <td
                  key={index}
                  className="text-right font-mono whitespace-nowrap tabular-nums"
                >
                  {cell}
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export { chartColor, type ColorVar, type Series }
