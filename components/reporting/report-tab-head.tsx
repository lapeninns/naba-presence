import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The row above a report (reference `.tab-head`): when the figures are from
 * on the left, the period and the Google refresh on the right. Wraps under
 * itself on a narrow screen, controls stretching to the full width.
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
  return (
    <div
      data-slot="report-tab-head"
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-4 gap-y-3",
        className
      )}
    >
      {/* No caption (loading, error, nothing collected): no empty row above
          the controls on a phone; the controls keep to the right. */}
      {caption ? (
        <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-2.5">
          {caption}
        </div>
      ) : null}
      {controls ? (
        <div className="flex w-full flex-wrap items-end gap-2 sm:ml-auto sm:w-auto">
          {controls}
        </div>
      ) : null}
    </div>
  )
}

/** Tiles in rows: one at the narrowest, two from 21rem, `wide` columns from 48rem. */
export function reportTileGridClassName(count: 4 | 5 = 4) {
  return cn(
    "grid grid-cols-1 gap-3 @[21rem]/report:grid-cols-2",
    count === 4
      ? "@[48rem]/report:grid-cols-4"
      : "@[40rem]/report:grid-cols-3 @[60rem]/report:grid-cols-5"
  )
}
