import * as React from "react"

import { DiffView } from "@/components/ui/diff-view"
import { formatDateTime } from "@/lib/format"

export type ChangeRow = {
  /** Unique row key; defaults to `field`. */
  key?: string
  /** The field in the customer's words, not the provider's. */
  field: string
  /** The reviewed value before the write. */
  before: React.ReactNode
  /** What the write makes it. */
  after: React.ReactNode
  /**
   * `conflict` means Google changed this field since the draft started, so
   * publishing overwrites someone else's edit. `unchanged` is a row shown for
   * context (the link a "make preferred" change applies to, say): it renders
   * one neutral value and "No change". Rows whose `before` and `after` are
   * the same text are treated as unchanged when no state is given.
   */
  state?: "changed" | "conflict" | "unchanged"
  /** An unresolved comparison must be resolved before publication. */
  blocking?: boolean
  explanation?: string
  /** Set only when an observed baseline proves the timing of a Google edit. */
  observedAfterEditing?: boolean
}

/**
 * Where the write the diff describes stands, which decides what the columns
 * may honestly claim:
 *
 * - `review`: nothing sent yet, so the left column is what Google holds now
 *   and the right one is what publishing would make it.
 * - `sent`: a request is recorded, so the left column is only the reviewed
 *   baseline and the right one what was sent. Neither is a claim about what
 *   Google shows now.
 * - `confirmed`: an independent observation matched the request, so the
 *   right column is what Google shows, as of that observation.
 */
export type ChangeDiffPhase = "review" | "sent" | "confirmed"

type OutcomeLike = {
  readonly confirmationState?: string | null
  readonly observedAt?: string | null
}

/** The diff phase for an approval sheet's saved outcome. */
export function outcomePhase(
  outcome: OutcomeLike | null | undefined,
  uncertain = false
): ChangeDiffPhase {
  if (outcome?.confirmationState === "confirmed") return "confirmed"
  return outcome || uncertain ? "sent" : "review"
}

function viewerZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function validInstant(iso: string) {
  return Number.isFinite(new Date(iso).getTime())
}

/** A stored instant in the viewer's local time: "30 Sept, 19:49". */
export function formatInstant(iso: string): string {
  return validInstant(iso) ? formatDateTime(iso, viewerZone()) : iso
}

/**
 * A stored instant for people, with the machine value kept in `dateTime`
 * (and on hover) for anyone who needs the exact record.
 */
export function ReviewTime({ value }: { readonly value: string }) {
  return (
    <time dateTime={value} title={value}>
      {formatInstant(value)}
    </time>
  )
}

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/** Renders a cell value as local time when it is an ISO instant. */
export function instantCell(value: React.ReactNode): React.ReactNode {
  return typeof value === "string" &&
    ISO_INSTANT.test(value) &&
    validInstant(value) ? (
    <ReviewTime value={value} />
  ) : (
    value
  )
}

export function changeDiffLabels(
  phase: ChangeDiffPhase,
  confirmedAt?: string | null
): { beforeLabel: string; afterLabel: string } {
  if (phase === "confirmed")
    return {
      beforeLabel: "Before",
      afterLabel: confirmedAt
        ? `Now on Google (confirmed ${formatInstant(confirmedAt)})`
        : "Now on Google (confirmed)",
    }
  if (phase === "sent")
    return { beforeLabel: "Before (reviewed)", afterLabel: "Sent" }
  return { beforeLabel: "On Google now", afterLabel: "After publishing" }
}

function sameText(a: React.ReactNode, b: React.ReactNode) {
  return (
    (typeof a === "string" || typeof a === "number") &&
    (typeof b === "string" || typeof b === "number") &&
    String(a) === String(b)
  )
}

/**
 * Field-level before and after for every write that reaches Google: the
 * shared `DiffView` (reference `.diff`) with the editor's row type. A real
 * table, so a screen reader announces "Phone, On Google now, 01223 277 217"
 * rather than two disconnected lists; under 560px of its own width the
 * columns stack and each value carries its column label.
 *
 * `phase` relabels the columns once a request exists, so an outcome never
 * calls the pre-write snapshot "On Google now".
 */
function ChangeDiff({
  rows,
  caption,
  phase = "review",
  confirmedAt,
}: {
  rows: ChangeRow[]
  caption: string
  phase?: ChangeDiffPhase
  /** When the confirming observation was made (phase `confirmed`). */
  confirmedAt?: string | null
}) {
  // DiffView keys rows by field name; two rows that share a name (a date
  // listed twice, say) get the key appended so React can tell them apart
  // without changing what is read out.
  const seen = new Map<string, number>()
  const diffRows = rows.map((row) => {
    const count = seen.get(row.field) ?? 0
    seen.set(row.field, count + 1)
    const unchanged =
      row.state === "unchanged" ||
      (row.state === undefined && sameText(row.before, row.after))
    return {
      field: count === 0 ? row.field : `${row.field}⁠${"​".repeat(count)}`,
      before: row.before,
      after: unchanged ? (
        <span className="text-ink-muted">No change</span>
      ) : (
        row.after
      ),
      state: unchanged ? ("unchanged" as const) : row.state,
    }
  })
  return (
    <DiffView
      rows={diffRows}
      caption={caption}
      {...changeDiffLabels(phase, confirmedAt)}
    />
  )
}

export { ChangeDiff }
