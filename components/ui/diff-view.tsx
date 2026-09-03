import * as React from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
   * explicit acknowledgement.
   */
  state?: "changed" | "conflict" | "unchanged"
}

/**
 * Field-level before and after, for every write that reaches Google.
 *
 * A table, not two stacked panels: the comparison is row-wise, and a real
 * table lets a screen reader announce "Phone, on Google now, 01223 277 217"
 * instead of reading two disconnected lists and leaving the pairing to the
 * listener.
 */
function DiffView({
  rows,
  beforeLabel = "On Google now",
  afterLabel = "Will change to",
  caption,
  className,
}: {
  rows: DiffRow[]
  beforeLabel?: string
  afterLabel?: string
  caption: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-(--np-radius-card) border border-line",
        className
      )}
    >
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Field</TableHead>
            <TableHead>{beforeLabel}</TableHead>
            <TableHead>{afterLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.field}>
              <TableCell className="align-top font-medium">
                <span className="flex flex-col gap-1">
                  {row.field}
                  {row.state === "conflict" ? (
                    <StatusPill tone="attention" variant="inline">
                      Changed on Google
                    </StatusPill>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="align-top text-ink-muted">
                {row.before || <span className="text-ink-muted">Not set</span>}
              </TableCell>
              <TableCell className="align-top">
                {row.after || <span className="text-ink-muted">Cleared</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { DiffView }
