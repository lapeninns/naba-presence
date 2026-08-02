"use client"

import {
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

import { ReportingPanel } from "@/components/reporting/reporting-states"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ColorVar = 1 | 2 | 3 | 4 | 5
type Series = { key: string; label: string; colorVar: ColorVar }

function chartColor(colorVar: ColorVar): string {
  return `var(--chart-${colorVar})`
}

export function ChartLegend({ items }: { items: Array<{ label: string; colorVar: ColorVar }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span
            aria-hidden
            className="size-2.5 rounded-(--nr-radius-tag)"
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
          {description ? <div className="text-caption text-muted-foreground">{description}</div> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <ReportingPanel variant="loading" />
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

const AXIS_PROPS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

export function ReportingLineChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  xTickFormatter?: (value: string) => string
  series: Series[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--nr-radius-control)",
            color: "var(--popover-foreground)",
            fontSize: "0.8125rem",
          }}
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
            connectNulls={false}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  )
}

export function ReportingBarChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  xTickFormatter?: (value: string) => string
  series: Series[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--nr-radius-control)",
            color: "var(--popover-foreground)",
            fontSize: "0.8125rem",
          }}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={chartColor(s.colorVar)} radius={[4, 4, 0, 0]} />
        ))}
      </RBarChart>
    </ResponsiveContainer>
  )
}
