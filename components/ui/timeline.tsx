import * as React from "react"

import { cn } from "@/lib/utils"

export type TimelineEntry = {
  id: string
  title: React.ReactNode
  /** Who and when, already formatted. */
  meta?: React.ReactNode
  detail?: React.ReactNode
  /** Overrides the default rail dot, e.g. a status colour. */
  marker?: React.ReactNode
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
      {entries.map((entry, index) => (
        <li key={entry.id} className="grid grid-cols-[16px_1fr] gap-x-3">
          <div className="flex flex-col items-center" aria-hidden>
            <span className="mt-1.5 flex size-2 shrink-0 items-center justify-center rounded-full bg-[var(--np-line-strong)]">
              {entry.marker}
            </span>
            {index < entries.length - 1 ? (
              <span className="mt-1 w-px flex-1 bg-line-subtle" />
            ) : null}
          </div>
          <div className={cn("pb-3", index === entries.length - 1 && "pb-0")}>
            <p className="text-ui font-medium">{entry.title}</p>
            {entry.meta ? (
              <p className="text-caption text-ink-muted">{entry.meta}</p>
            ) : null}
            {entry.detail ? <div className="mt-1">{entry.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export { Timeline }
