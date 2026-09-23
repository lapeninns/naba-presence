import * as React from "react"

import { DiffView } from "@/components/ui/diff-view"

export type ChangeRow = {
  /** Unique row key; defaults to `field`. */
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
 * Field-level before and after for every write that reaches Google: the
 * shared `DiffView` (reference `.diff`) with the editor's row type. A real
 * table, so a screen reader announces "Phone, On Google now, 01223 277 217"
 * rather than two disconnected lists; under 560px of its own width the
 * columns stack and each value carries its column label.
 */
function ChangeDiff({ rows, caption }: { rows: ChangeRow[]; caption: string }) {
  // DiffView keys rows by field name; two rows that share a name (a date
  // listed twice, say) get the key appended so React can tell them apart
  // without changing what is read out.
  const seen = new Map<string, number>()
  const diffRows = rows.map((row) => {
    const count = seen.get(row.field) ?? 0
    seen.set(row.field, count + 1)
    return {
      field: count === 0 ? row.field : `${row.field}⁠${"​".repeat(count)}`,
      before: row.before,
      after: row.after,
      state: row.state,
    }
  })
  return <DiffView rows={diffRows} caption={caption} />
}

export { ChangeDiff }
