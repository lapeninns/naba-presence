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
 * own container is narrower than 36rem the columns stack, and each value
 * shows its column label above it (a caption, never below the 12px floor).
 *
 * Labels are props: `fieldLabel`, `beforeLabel`, `afterLabel`.
 *
 * `variant="flat"` draws the same table with no card and no tints, for a
 * diff that already sits inside a sheet or editor surface: the field name
 * and the old value in muted ink (the old one struck through in muted ink),
 * the new value in ink at the regular weight, rows split by hairlines. The
 * words "Not set" and "Cleared" and the strike-through still say which
 * value is which without colour.
 */
function DiffView({
  rows,
  fieldLabel = "Field",
  beforeLabel = "On Google now",
  afterLabel = "After publishing",
  caption,
  variant = "card",
  className,
}: {
  rows: DiffRow[]
  /** `card` (default): bordered card with tints. `flat`: no card, no tints. */
  variant?: "card" | "flat"
  fieldLabel?: string
  beforeLabel?: string
  afterLabel?: string
  caption: string
  className?: string
}) {
  const flat = variant === "flat"
  const headCell = cn(
    "border-b border-line px-3 py-2.5 text-left text-caption text-ink-muted",
    flat ? "font-medium" : "bg-surface-alt font-semibold"
  )
  return (
    <div
      data-slot="diff-view"
      data-variant={variant}
      className={cn(
        "@container/diff min-w-0 overflow-hidden",
        !flat && "rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
    >
      <table
        className={cn(
          "w-full table-fixed border-collapse text-ui text-ink",
          "@max-xl/diff:block @max-xl/diff:[&_tbody]:block @max-xl/diff:[&_td]:block @max-xl/diff:[&_th[scope=row]]:block @max-xl/diff:[&_thead]:hidden @max-xl/diff:[&_tr]:block"
        )}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn("w-1/4", headCell)}>
              {fieldLabel}
            </th>
            <th scope="col" className={headCell}>
              {beforeLabel}
            </th>
            <th scope="col" className={headCell}>
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
                className={cn(
                  "border-b last:border-0",
                  flat ? "border-line-subtle" : "border-line"
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    "px-3 py-2.5 text-left align-top break-words",
                    flat
                      ? "font-normal text-ink-muted"
                      : "font-semibold text-ink @max-xl/diff:bg-surface-alt"
                  )}
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
                    "@max-xl/diff:before:block @max-xl/diff:before:text-caption @max-xl/diff:before:text-ink-secondary @max-xl/diff:before:content-[attr(data-label)]",
                    flat
                      ? "text-ink-muted"
                      : changed
                        ? "bg-danger-tint text-ink-secondary"
                        : "text-ink-muted"
                  )}
                >
                  {row.before ? (
                    changed ? (
                      <del
                        className={
                          flat ? "decoration-ink-muted" : "decoration-danger-ink"
                        }
                      >
                        {row.before}
                      </del>
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
                    "@max-xl/diff:before:block @max-xl/diff:before:text-caption @max-xl/diff:before:font-normal @max-xl/diff:before:text-ink-secondary @max-xl/diff:before:content-[attr(data-label)]",
                    changed && !flat
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
