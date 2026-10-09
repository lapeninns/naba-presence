import * as React from "react"

import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"

export type DiffRow = {
  /** Field name in the customer's words, not the provider's. */
  field: string
  /** What Google shows now. */
  before: React.ReactNode
  /** What publishing would make it. */
  after: React.ReactNode
  /**
   * `conflict` means Google changed this field since the draft started, so
   * publishing overwrites someone else's edit and the sheet asks for an
   * explicit acknowledgement. Rows without a state are treated as `changed`.
   */
  state?: "changed" | "conflict" | "unchanged"
}

/**
 * Field-level before and after, for every write that reaches Google
 * (reference `.diff`).
 *
 * Three columns — the field, "On Google now", "After publishing" — in a
 * bordered card with a sunken header row. The old value sits on the danger
 * tint struck through; the new value on the success tint in semibold. An
 * unchanged row carries neither. The words "Not set" and "Cleared" say what
 * an empty cell means, so the tint is never the only signal.
 *
 * Still a real table, so a screen reader announces "Phone, On Google now,
 * 01223 277 217" instead of leaving the pairing to the listener. When its
 * own container is narrower than 560px the columns stack, and each value
 * shows its column label above it.
 *
 * Labels are props: `fieldLabel`, `beforeLabel`, `afterLabel`.
 */
function DiffView({
  rows,
  fieldLabel = "Field",
  beforeLabel = "On Google now",
  afterLabel = "After publishing",
  caption,
  className,
}: {
  rows: DiffRow[]
  fieldLabel?: string
  beforeLabel?: string
  afterLabel?: string
  caption: string
  className?: string
}) {
  return (
    <div
      data-slot="diff-view"
      className={cn(
        "@container/diff min-w-0 overflow-hidden rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
    >
      <table
        className={cn(
          "w-full table-fixed border-collapse text-ui text-ink",
          "@max-[560px]/diff:block @max-[560px]/diff:[&_tbody]:block @max-[560px]/diff:[&_td]:block @max-[560px]/diff:[&_th[scope=row]]:block @max-[560px]/diff:[&_thead]:hidden @max-[560px]/diff:[&_tr]:block"
        )}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-[clamp(120px,24%,180px)] border-b border-line bg-surface-alt px-3 py-2.5 text-left text-caption font-semibold text-ink-muted"
            >
              {fieldLabel}
            </th>
            <th
              scope="col"
              className="border-b border-line bg-surface-alt px-3 py-2.5 text-left text-caption font-semibold text-ink-muted"
            >
              {beforeLabel}
            </th>
            <th
              scope="col"
              className="border-b border-line bg-surface-alt px-3 py-2.5 text-left text-caption font-semibold text-ink-muted"
            >
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const changed = row.state !== "unchanged"
            return (
              <tr
                key={row.field}
                data-state={row.state ?? "changed"}
                className="border-b border-line last:border-0"
              >
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left align-top font-semibold break-words text-ink @max-[560px]/diff:bg-surface-alt"
                >
                  <span className="flex flex-col items-start gap-1">
                    {row.field}
                    {row.state === "conflict" ? (
                      <StatusPill tone="attention">
                        Changed on Google
                      </StatusPill>
                    ) : null}
                  </span>
                </th>
                <td
                  data-label={beforeLabel}
                  className={cn(
                    "px-3 py-2.5 align-top [overflow-wrap:anywhere]",
                    "@max-[560px]/diff:before:block @max-[560px]/diff:before:text-[11px] @max-[560px]/diff:before:text-ink-secondary @max-[560px]/diff:before:content-[attr(data-label)]",
                    changed
                      ? "bg-danger-tint text-ink-secondary"
                      : "text-ink-muted"
                  )}
                >
                  {row.before ? (
                    changed ? (
                      <del className="decoration-danger-ink">{row.before}</del>
                    ) : (
                      row.before
                    )
                  ) : (
                    <span>Not set</span>
                  )}
                </td>
                <td
                  data-label={afterLabel}
                  className={cn(
                    "px-3 py-2.5 align-top [overflow-wrap:anywhere]",
                    "@max-[560px]/diff:before:block @max-[560px]/diff:before:text-[11px] @max-[560px]/diff:before:font-normal @max-[560px]/diff:before:text-ink-secondary @max-[560px]/diff:before:content-[attr(data-label)]",
                    changed
                      ? "bg-success-tint font-semibold text-ink"
                      : "text-ink"
                  )}
                >
                  {row.after ? (
                    changed ? (
                      <ins className="no-underline">{row.after}</ins>
                    ) : (
                      row.after
                    )
                  ) : (
                    <span>Cleared</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export { DiffView }
