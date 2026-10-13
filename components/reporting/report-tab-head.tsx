import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The caption line at the top of a report tab: when the figures are from
 * ("As at 12 Oct") on the left, a tab-specific action such as "Refresh from
 * Google" at the end. The scope and the period are not here: they live once,
 * above the tabs, in `ReportToolbar` (components/reporting/report-toolbar).
 *
 * `controls` is kept for actions only; a period select belongs in the
 * toolbar. Draws nothing when it has neither, so a loading tab has no empty
 * row.
 */
export function ReportTabHead({
  caption,
  controls,
  className,
}: {
  caption: React.ReactNode
  controls?: React.ReactNode
  className?: string
}) {
  if (!caption && !controls) return null
  return (
    <div
      data-slot="report-tab-head"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
        className
      )}
    >
      {caption ? (
        <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2">
          {caption}
        </div>
      ) : null}
      {controls ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {controls}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Tiles in rows: two to a row from the narrowest phone, then four (or three
 * and five) as the report's container widens.
 */
export function reportTileGridClassName(count: 4 | 5 = 4) {
  return cn(
    "grid grid-cols-2 gap-3",
    count === 4
      ? "@[48rem]/report:grid-cols-4"
      : "@[40rem]/report:grid-cols-3 @[60rem]/report:grid-cols-5"
  )
}
