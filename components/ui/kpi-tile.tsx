import * as React from "react"

import { cn } from "@/lib/utils"

type KpiTileProps = {
  label: string
  value: React.ReactNode
  /** One short line of context: the window, the target, the comparison. */
  hint?: React.ReactNode
  /** A delta badge, sparkline or similar. */
  trailing?: React.ReactNode
  className?: string
}

/**
 * A single headline figure.
 *
 * The label is a `p`, never a heading: these appear in rows of four under a
 * page `h1`, and four `h2`s carrying "Average rating" would flood the heading
 * outline that the axe suite pins.
 */
function KpiTile({ label, value, hint, trailing, className }: KpiTileProps) {
  return (
    <div
      data-slot="kpi-tile"
      className={cn(
        "flex flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface px-(--np-card-pad) py-(--np-card-pad)",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption font-medium text-ink-muted">{label}</p>
        {trailing}
      </div>
      <p className="font-display text-display tabular-nums">{value}</p>
      {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
    </div>
  )
}

export { KpiTile, type KpiTileProps }
