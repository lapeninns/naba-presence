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

export type ChangeRow = {
  /** Unique row key; defaults to `field`. Needed when two rows share a name. */
  key?: string
  /** The field in the customer's words, not the provider's. */
  field: string
  /** What Google shows now. */
  before: React.ReactNode
  /** What publishing would make it. */
  after: React.ReactNode
  /**
   * `conflict` means Google changed this field since the draft started, so
   * publishing overwrites someone else's edit.
   */
  state?: "changed" | "conflict"
}

/**
 * Field-level before and after for every write that reaches Google.
 *
 * A table, not two stacked panels: the comparison is row-wise, and a real
 * table lets a screen reader announce "Phone, on Google now, 01223 277 217"
 * rather than reading two disconnected lists and leaving the pairing to the
 * listener.
 *
 * It sits on the sheet's white, so its boundary is a hairline rather than a
 * second white card.
 */
function ChangeDiff({ rows, caption }: { rows: ChangeRow[]; caption: string }) {
  return (
    <div
      data-slot="change-diff"
      className="overflow-hidden rounded-(--np-radius-card) hairline"
    >
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Field</TableHead>
            <TableHead>On Google now</TableHead>
            <TableHead>Will change to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key ?? row.field} data-state={row.state}>
              <TableCell className="align-top font-medium text-ink">
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
                {row.before || <span className="text-ink-faint">Not set</span>}
              </TableCell>
              <TableCell className="align-top text-ink">
                {row.after || <span className="text-ink-faint">Cleared</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { ChangeDiff }
