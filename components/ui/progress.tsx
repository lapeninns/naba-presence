import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Progress (reference `.progress` and `.meter`).
 *
 * `Progress` is work moving toward done: a 6px track on the fill grey with
 * the accent (or danger, when `tone="bad"`) filling it. Omit `value` for an
 * indeterminate bar (length unknown). Always name it with `label` (visible
 * or `aria-label`), so the bar is never the only statement of progress.
 *
 * `status` puts the state in words above the bar ("Importing", "Waiting
 * for Google", "Paused"), for work that has a state but no count. The word
 * leads; the bar only reinforces it. It is also the bar's `aria-valuetext`
 * when it is a string, so an indeterminate bar announces "Importing" rather
 * than nothing. `figure` sits on the right of the same line ("3 of 12").
 * With `status`, `className` styles the wrapper and `barClassName` the bar.
 * Under reduced motion the travelling highlight stops (the global rule) and
 * the word carries the state on its own.
 *
 * `Meter` is a measured share, not progress: a label row with the figure in
 * tabular figures, and an 8px track in the first chart colour.
 */
function Progress({
  value,
  max = 100,
  tone = "default",
  label,
  status,
  figure,
  barClassName,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** 0..max. Omit for indeterminate. */
  value?: number | null
  max?: number
  tone?: "default" | "bad"
  /** Accessible name; also pass `aria-label` or `aria-labelledby` instead. */
  label?: string
  /** The state in words, shown above the bar (words first). */
  status?: React.ReactNode
  /** A figure on the right of the status line ("3 of 12"). */
  figure?: React.ReactNode
  /** Classes for the bar itself when `status` wraps it. */
  barClassName?: string
}) {
  const indeterminate = value === undefined || value === null
  const pct = indeterminate
    ? 0
    : Math.max(0, Math.min(100, (Number(value) / max) * 100))
  const statusId = React.useId()
  const hasStatus = status !== undefined && status !== null && status !== false
  const bar = (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Number(value)}
      aria-valuetext={
        hasStatus && typeof status === "string"
          ? indeterminate
            ? status
            : `${status}, ${Math.round(pct)}%`
          : undefined
      }
      aria-describedby={
        hasStatus && typeof status !== "string" ? statusId : undefined
      }
      data-slot="progress"
      data-indeterminate={indeterminate || undefined}
      className={cn(
        "h-1.5 overflow-hidden rounded-(--np-radius-pill) bg-fill",
        hasStatus ? barClassName : className
      )}
      {...props}
    >
      {indeterminate ? (
        // The travelling highlight reuses the global `shimmer` keyframe: a
        // full-width carrier slides from -100% to 100% holding a 35% bar.
        <span className="block h-full w-full animate-shimmer motion-reduce:animate-none">
          <span
            className={cn(
              "block h-full w-[35%] rounded-(--np-radius-pill)",
              tone === "bad" ? "bg-danger-solid" : "bg-primary"
            )}
          />
        </span>
      ) : (
        <span
          className={cn(
            "block h-full w-(--progress) rounded-[inherit] transition-[width] duration-(--np-duration-deliberate) ease-out-strong",
            tone === "bad" ? "bg-danger-solid" : "bg-primary"
          )}
          style={{ "--progress": `${pct}%` } as React.CSSProperties}
        />
      )}
    </div>
  )
  if (!hasStatus) return bar
  return (
    <div data-slot="progress-status" className={cn("grid gap-1", className)}>
      <div className="flex items-baseline justify-between gap-3 text-caption">
        <span
          id={statusId}
          data-slot="progress-status-word"
          className={cn(
            "min-w-0 font-medium",
            tone === "bad" ? "text-danger-ink" : "text-ink-secondary"
          )}
        >
          {status}
        </span>
        {figure !== undefined && figure !== null ? (
          <span className="shrink-0 text-ink-muted tabular-nums">{figure}</span>
        ) : null}
      </div>
      {bar}
    </div>
  )
}

function Meter({
  label,
  value,
  display,
  max = 100,
  className,
}: {
  label: React.ReactNode
  /** 0..max */
  value: number
  /** The figure as shown ("83%"). Defaults to the rounded percentage. */
  display?: React.ReactNode
  max?: number
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const id = React.useId()
  return (
    <div data-slot="meter" className={cn("grid gap-1", className)}>
      <div className="flex items-center justify-between gap-3 text-ui">
        <span id={id}>{label}</span>
        <span className="font-semibold tabular-nums">
          {display ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-(--np-radius-pill) bg-fill"
      >
        <span
          className="block h-full w-(--meter) rounded-[inherit] bg-chart-1"
          style={{ "--meter": `${pct}%` } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

export { Meter, Progress }
