import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type SummaryRow = {
  readonly label: string
  readonly value: ReactNode
  /**
   * A machine reference (a Google resource name, place ID, language tag).
   * Technical rows are kept out of the human summary and listed, collapsed,
   * under "Technical details" so people read names before codes.
   */
  readonly technical?: boolean
}

/**
 * What a reviewed write will do, as label/value rows: stacked on a phone,
 * two columns from `sm`, a hairline between rows and no box around them
 * (the label muted in `text-ui`, the value in `text-body`). The human rows
 * come first; technical references follow in a quiet collapsed disclosure
 * (`TechnicalDetails`).
 */
export function SummaryList({
  rows,
  className,
  "aria-label": ariaLabel,
}: {
  readonly rows: readonly SummaryRow[]
  readonly className?: string
  readonly "aria-label"?: string
}) {
  const human = rows.filter((row) => !row.technical)
  const technical = rows.filter((row) => row.technical)
  return (
    <div data-slot="summary-list" className={cn("flex min-w-0 flex-col gap-2", className)}>
      {human.length > 0 ? (
        <dl aria-label={ariaLabel} className="divide-y divide-line-subtle">
          {human.map((row) => (
            <div
              key={row.label}
              className="grid min-w-0 gap-0.5 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3"
            >
              <dt className="text-ui text-ink-muted">{row.label}</dt>
              <dd className="min-w-0 text-body break-words whitespace-pre-wrap text-ink">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {technical.length > 0 ? (
        <TechnicalDetails>
          {technical.map((row) => (
            <ResourceRef key={row.label} label={row.label} value={row.value} />
          ))}
        </TechnicalDetails>
      ) : null}
    </div>
  )
}

/**
 * A collapsed "Technical details" disclosure for exact Google references:
 * a quiet muted line with a chevron, no box, its contents indented under it.
 * They stay one tap away for support and audit, and out of the way of the
 * names and actions a person reads first.
 */
export function TechnicalDetails({
  children,
  summary = "Technical details",
  list = true,
  className,
}: {
  readonly children: ReactNode
  readonly summary?: string
  /** Children are `ResourceRef` rows (a `dl`); false for free content. */
  readonly list?: boolean
  readonly className?: string
}) {
  return (
    <details data-slot="technical-details" className={cn("group min-w-0", className)}>
      <summary className="flex min-h-(--np-control-h) w-fit cursor-pointer items-center gap-2 rounded-(--np-radius-control) text-ui text-ink-muted focus-halo marker:content-none hover-fine:text-ink-secondary [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-ink-muted transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
        {/* Its own element, so "Technical details" is findable as text
            without the chevron. */}
        <span>{summary}</span>
      </summary>
      {list ? (
        <dl className="flex min-w-0 flex-col gap-2 pt-1 pb-2.5 pl-5">{children}</dl>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 pt-1 pb-2.5 pl-5 text-ui text-ink-secondary">{children}</div>
      )}
    </details>
  )
}

/** One exact reference inside `TechnicalDetails`: a label and a mono value. */
export function ResourceRef({
  label,
  value,
}: {
  readonly label: string
  readonly value: ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-mono text-caption break-all text-ink">{value}</dd>
    </div>
  )
}
