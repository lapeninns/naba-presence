"use client"

import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"

export type EditorStatus =
  "in_sync" | "edited" | "unpublished" | "google_dirty" | "conflict"

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
 *
 * Visually it is a toolbar: the toolbar material with a hairline top edge,
 * the status at the leading edge and the actions at the trailing edge with
 * the primary last. `EditorFrame` pins it to the bottom of the scrolling
 * pane so it stays in reach however long the form above it is.
 */
function EditorFooter({
  status,
  isDirty,
  canDiscard,
  onReview,
  onDiscard,
  disabledReason,
  hint,
  className,
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
  className?: string
}) {
  const entry = STATUS[status]
  return (
    <div
      data-slot="editor-footer"
      className={cn(
        "flex flex-col gap-2 material-toolbar py-3 [box-shadow:inset_0_0.5px_0_var(--np-line)]",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill tone={entry.tone}>{entry.label}</StatusPill>
        <p className="text-ui text-ink-muted">
          {isDirty
            ? "Nothing changes on Google until you publish."
            : (hint ?? "No unpublished changes.")}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
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
