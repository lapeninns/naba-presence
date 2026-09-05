import * as React from "react"

import { cn } from "@/lib/utils"

export type TimelineTone =
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"

export type TimelineEntry = {
  id: string
  title: React.ReactNode
  /** Who and when, already formatted. */
  meta?: React.ReactNode
  detail?: React.ReactNode
  /** Overrides the default rail dot, e.g. a status colour. */
  marker?: React.ReactNode
  /**
   * Colours the rail dot. `accent` is the default; the status tones use the
   * solid status colours. Never the only signal: the state must also be in
   * the title or meta.
   */
  tone?: TimelineTone
}

const DOT_TONE_CLASS: Record<TimelineTone, string> = {
  accent: "bg-(--np-accent-vivid)",
  success: "bg-(--np-success-solid)",
  warning: "bg-(--np-warning-ink)",
  danger: "bg-(--np-danger-solid)",
  info: "bg-(--np-info-solid)",
  neutral: "bg-(--np-line-strong)",
}

/**
 * A chronological list: activity, approvals, verification history.
 *
 * An `ol` because order is the meaning. Entry titles are plain text, not
 * headings, so a timeline can sit inside any section without disturbing the
 * heading outline.
 */
function Timeline({
  entries,
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & { entries: TimelineEntry[] }) {
  return (
    <ol data-slot="timeline" className={cn("flex flex-col", className)} {...props}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1
        return (
          <li key={entry.id} className="grid grid-cols-[8px_1fr] gap-x-3">
            <div className="flex flex-col items-center" aria-hidden>
              <span
                className={cn(
                  "mt-1.5 flex size-2 shrink-0 items-center justify-center rounded-full",
                  DOT_TONE_CLASS[entry.tone ?? "accent"]
                )}
              >
                {entry.marker}
              </span>
              {!isLast ? (
                <span className="mt-1 w-px flex-1 bg-line-subtle" />
              ) : null}
            </div>
            <div className={cn("pb-4", isLast && "pb-0")}>
              <p className="text-body font-medium text-ink">{entry.title}</p>
              {entry.meta ? (
                <p className="text-caption text-ink-muted tabular-nums">
                  {entry.meta}
                </p>
              ) : null}
              {entry.detail ? (
                <div className="mt-1 text-body text-ink">{entry.detail}</div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { Timeline }
