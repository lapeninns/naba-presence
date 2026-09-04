"use client"

import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"

export type EditorStatus =
  | "in_sync"
  | "edited"
  | "unpublished"
  | "google_dirty"
  | "conflict"

const STATUS: Record<
  EditorStatus,
  { tone: "healthy" | "attention" | "at-risk" | "neutral"; label: string }
> = {
  in_sync: { tone: "healthy", label: "In sync with Google" },
  edited: { tone: "attention", label: "Edited" },
  // Saved here, never sent. "Edited" read as "you just changed something",
  // which is wrong when the difference has been sitting there for a week.
  unpublished: { tone: "attention", label: "Not on Google yet" },
  google_dirty: { tone: "attention", label: "Changed on Google" },
  conflict: { tone: "at-risk", label: "Conflict" },
}

/**
 * The one footer every location editor ends with.
 *
 * Replaces `SaveBar`, whose two side-by-side buttons — "Save changes" and
 * "Publish to Google" — asked the operator to understand a distinction the
 * product never explained: which one puts words in front of customers. Some
 * tabs had that pair, some published immediately, and one used a confirmation
 * dialog, so "saved" meant something different on every screen.
 *
 * Here there is one primary action. It opens a sheet showing exactly what will
 * change on Google, and publishing happens from there.
 */
function EditorFooter({
  status,
  isDirty,
  canDiscard,
  onReview,
  onDiscard,
  disabledReason,
  hint,
}: {
  status: EditorStatus
  /** Anything to publish: local edits, or drift that was already there. */
  isDirty: boolean
  /** Local edits that can be thrown away. Defaults to `isDirty`. */
  canDiscard?: boolean
  onReview: () => void
  onDiscard: () => void
  /** Why the operator cannot publish, in their words. Never a raw code. */
  disabledReason?: string | null
  /** Context that helps the decision: when this was last published, by whom. */
  hint?: React.ReactNode
}) {
  const entry = STATUS[status]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3">
        <StatusPill tone={entry.tone}>{entry.label}</StatusPill>
        <p className="text-ui text-ink-muted">
          {isDirty
            ? "Nothing changes on Google until you publish."
            : (hint ?? "No unpublished changes.")}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={onDiscard}
            disabled={!(canDiscard ?? isDirty)}
          >
            Discard
          </Button>
          <Button
            onClick={onReview}
            disabled={!isDirty || Boolean(disabledReason)}
          >
            Review changes
          </Button>
        </div>
      </div>
      <GateNote reason={disabledReason ?? null} />
    </div>
  )
}

export { EditorFooter }
