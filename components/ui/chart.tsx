"use client"

import * as React from "react"
import {
  Area,
  AreaChart as RAreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TooltipContentProps } from "recharts"

import { ReportingPanel } from "@/components/reporting/reporting-states"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

type ColorVar = 1 | 2 | 3 | 4 | 5 | 6
type Series = { key: string; label: string; colorVar: ColorVar }

/** The measured chart hue for a series slot, as a CSS variable reference. */
function chartColor(colorVar: ColorVar): string {
  return `var(--np-chart-${colorVar})`
}

export function ChartLegend({ items }: { items: Array<{ label: string; colorVar: ColorVar }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-caption text-ink-muted">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: chartColor(item.colorVar) }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({
  title,
  description,
  action,
  state,
  onRetry,
  emptyLabel,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  state: "ready" | "loading" | "empty" | "error"
  onRetry?: () => void
  emptyLabel?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          // The card's own title names the figures, so the skeleton borrows it
          // rather than repeating a generic "Loading".
          <ReportingPanel variant="loading" title={`Loading ${title.toLowerCase()}…`} />
        ) : state === "error" ? (
          <ReportingPanel variant="error" onRetry={onRetry} />
        ) : state === "empty" ? (
          <ReportingPanel variant="empty" description={emptyLabel} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The tooltip, drawn as a popover: the popover material, the pop shadow and
 * the control radius. Recharts hands it the hovered label and one payload
 * entry per series; figures are tabular and right-aligned so a stack of
 * series lines up.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  className,
}: Partial<TooltipContentProps> & { className?: string }) {
  if (!active || !payload || payload.length === 0) return null
  const heading = labelFormatter ? labelFormatter(label, payload) : label
  return (
    <div
      data-slot="chart-tooltip"
      className={cn(
        "material-popover min-w-32 rounded-(--np-radius-control) px-2.5 py-2 text-ui text-ink shadow-(--np-shadow-pop)",
        className
      )}
    >
      {heading !== undefined && heading !== null && heading !== "" ? (
        <p className="mb-1 text-caption text-ink-muted">{heading}</p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {payload.map((item, index) => (
          <li
            key={`${String(item.dataKey ?? item.name ?? index)}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? item.fill ?? item.stroke }}
              />
              {item.name}
            </span>
            <span className="text-right font-medium text-ink tabular-nums">
              {item.value as React.ReactNode}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Axis text is the caption role in the muted ink. The wrapper sets the
 * colour and `currentColor` carries it into the SVG, which is the one way a
 * presentation attribute reliably reads a design token.
 */
const AXIS_PROPS = {
  tick: { fontSize: 12, fill: "currentColor" },
  tickLine: false,
  axisLine: false,
  tickMargin: 6,
} as const

const GRID_PROPS = {
  vertical: false,
  stroke: "var(--np-chart-grid)",
  strokeWidth: 1,
} as const

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -12 }

function ChartFrame({
  height,
  children,
}: {
  height: number
  children: React.ReactElement
}) {
  return (
    <div className="text-caption text-ink-muted [&_.recharts-surface]:overflow-visible">
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function activeDotFor(colorVar: ColorVar) {
  return {
    r: 4,
    strokeWidth: 2,
    stroke: "var(--np-surface)",
    fill: chartColor(colorVar),
  }
}

type SeriesChartProps = {
  data: Array<Record<string, unknown>>
  xKey: string
  xTickFormatter?: (value: string) => string
  series: Series[]
  height?: number
}

export function ReportingLineChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: SeriesChartProps) {
  return (
    <ChartFrame height={height}>
      <RLineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          cursor={{ stroke: "var(--np-line)", strokeWidth: 1 }}
          content={<ChartTooltipContent />}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={chartColor(s.colorVar)}
            strokeWidth={2}
            dot={false}
            activeDot={activeDotFor(s.colorVar)}
            connectNulls={false}
          />
        ))}
      </RLineChart>
    </ChartFrame>
  )
}

export function ReportingBarChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: SeriesChartProps) {
  return (
    <ChartFrame height={height}>
      <RBarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          cursor={{ fill: "var(--np-fill-tertiary)" }}
          content={<ChartTooltipContent />}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={chartColor(s.colorVar)}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        ))}
      </RBarChart>
    </ChartFrame>
  )
}

/**
 * A line with a soft fill beneath it, fading from the series colour to
 * transparent. Same props as the line chart; use it when the area under the
 * curve is the story (volume over time), the line chart when it is the shape.
 */
export function ReportingAreaChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: SeriesChartProps) {
  // Gradient ids must be unique per chart instance, or two area charts on
  // one page would paint each other's colours.
  const gradientId = React.useId()
  const fillId = (key: string) => `${gradientId}-${key}`
  return (
    <ChartFrame height={height}>
      <RAreaChart data={data} margin={CHART_MARGIN}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={fillId(s.key)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColor(s.colorVar)} stopOpacity={0.28} />
              <stop offset="100%" stopColor={chartColor(s.colorVar)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          cursor={{ stroke: "var(--np-line)", strokeWidth: 1 }}
          content={<ChartTooltipContent />}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={chartColor(s.colorVar)}
            strokeWidth={2}
            fill={`url(#${fillId(s.key)})`}
            dot={false}
            activeDot={activeDotFor(s.colorVar)}
            connectNulls={false}
          />
        ))}
      </RAreaChart>
    </ChartFrame>
  )
}

export { chartColor, type ColorVar, type Series }
