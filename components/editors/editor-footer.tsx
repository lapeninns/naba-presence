"use client"

import { useId, useRef } from "react"

import { CircleAlert, CircleCheck, Clock, Eye, Save } from "lucide-react"

import { useReportEditorStatus } from "@/components/editors/editor-status"
import {
  ActionBar,
  ActionBarMuted,
  type ActionBarAction,
} from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import { useReturnFocus } from "@/lib/editors/use-return-focus"
import { cn } from "@/lib/utils"

export type EditorStatus =
  "in_sync" | "edited" | "unpublished" | "google_dirty" | "conflict"

/** The status words when no change count is given. */
const STATUS_WORDS: Record<EditorStatus, string> = {
  in_sync: "In sync with Google",
  edited: "Changes not on Google",
  // Saved here, never sent. "Edited" read as "you just changed something",
  // which is wrong when the difference has been sitting there for a week.
  unpublished: "Not on Google yet",
  google_dirty: "Changed on Google",
  conflict: "Conflict with Google",
}

const DEFAULT_REVIEW_LABEL = "Review changes"

function countWords(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"} not on Google`
}

/**
 * The one footer every location editor ends with: the dark action bar
 * (reference `.actionbar.editor-foot`), the single charcoal surface on the
 * screen, holding the action that reaches Google.
 *
 * A clean editor draws NO bar, at any width (the area header's pill already
 * says where the area stands); the bar arrives with the first change.
 *
 * Saving and publishing are different actions with different words. "Review
 * changes" is the one primary: it opens the sheet with the diff, and only
 * the sheet's "Publish to Google" sends anything. "Save here" (only where
 * the resource keeps a NabaPresence copy) writes that copy and nothing else;
 * "Discard edits" throws the local edits away. Both are secondaries of the
 * ActionBar, so a phone folds them into the "More actions" menu and the bar
 * stays one row (status, primary, overflow); from `md` they sit inline beside
 * the primary. A secondary with nothing to act on, or that can't run (its
 * reason is the bar's note), is left out, not greyed. When the edits leave
 * nothing to publish (they match Google), there is no "Review changes" and
 * "Save here" is the primary. The status line says which of the two has
 * happened: "unsaved edits" or "saved here"; while a save runs it leads with
 * "Saving…", since the phone's button is in a closed menu. After a save,
 * focus returns to the bar (or the editor) rather than falling to the page.
 *
 * A viewer gets the same bar with no buttons and the reason in words, so the
 * page never shows controls that can't be used without saying why.
 *
 * Phones (under 48rem): the bar docks edge to edge at the bottom of the
 * screen (the ActionBar's `dock`: the tab bar steps aside and scroll padding
 * follows its measured height), riding the keyboard.
 * Desk: the bar sits inline at the end of the form, where the fields it
 * saves end. The view-only bar is never docked: it sits inline and says why.
 */
function EditorFooter({
  status,
  isDirty,
  canDiscard,
  onReview,
  onDiscard,
  disabledReason,
  className,
  changeCount,
  emptyOnGoogle,
  onSave,
  saving = false,
  saveDisabledReason,
  saveDescription,
  readOnlyReason,
  reviewLabel = DEFAULT_REVIEW_LABEL,
  rail = false,
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
  className?: string
  /** How many fields differ from Google; words the status line. */
  changeCount?: number
  /** The header pill's words when nothing differs and Google holds nothing. */
  emptyOnGoogle?: string
  /**
   * Save NabaPresence's own copy without publishing. Omit for resources
   * that have no copy of their own (the button is then not drawn).
   */
  onSave?: () => void
  saving?: boolean
  /** Why "Save here" is unavailable, when it is drawn but can't run. */
  saveDisabledReason?: string | null
  /** Describes the scope of a partial local save, when this editor mixes models. */
  saveDescription?: string
  /**
   * View-only: the bar keeps its place and says why nothing can change, with
   * no buttons.
   */
  readOnlyReason?: string | null
  reviewLabel?: string
  /**
   * The editor lays its fields out beside a label rail on the desk (profile,
   * hours): start the bar at the form column, the rail's width plus the
   * grid's gap-x-6, so it lines up with the fields it saves.
   */
  rail?: boolean
}) {
  const saveDescriptionId = useId()
  const railClass = rail
    ? "desk:ml-[calc(var(--np-form-rail-w)+--spacing(6))]"
    : undefined
  const localEdits = canDiscard ?? isDirty
  const regionRef = useRef<HTMLDivElement>(null)
  // Save here leaves the bar once it has done its work: focus goes back to
  // the bar (or the editor), not the page.
  const returnFocus = useReturnFocus(regionRef)

  // Tell the area header (AreaFrame) what this footer says, so its pill
  // never reads "In sync" over unsaved edits. A view-only bar reports nothing.
  useReportEditorStatus(
    readOnlyReason
      ? null
      : {
          status,
          isDirty,
          localEdits,
          savesHere: Boolean(onSave),
          changeCount,
          emptyOnGoogle,
        }
  )

  if (readOnlyReason) {
    return (
      <ActionBar
        data-slot="editor-footer"
        sticky={false}
        safeArea={false}
        label="Editor actions"
        className={cn(railClass, className)}
        status={
          <>
            <Eye aria-hidden />
            <span className="min-w-0">
              View-only access.{" "}
              <ActionBarMuted>{readOnlyReason}</ActionBarMuted>
            </span>
          </>
        }
      />
    )
  }

  // Nothing to save, publish or resolve: no bar, at any width.
  if (!isDirty && !localEdits && status !== "conflict") return null

  // Nothing differs from Google (local edits only): say so, not "changes not
  // on Google", and offer no Review (there is nothing to publish).
  const headline =
    status === "conflict"
      ? STATUS_WORDS.conflict
      : !isDirty
        ? "No changes to publish"
        : typeof changeCount === "number" && changeCount > 0
          ? countWords(changeCount)
          : STATUS_WORDS[status === "in_sync" ? "edited" : status]
  const where = localEdits
    ? "unsaved edits"
    : status === "unpublished" || (onSave && isDirty)
      ? "saved here"
      : null
  const StatusIcon =
    status === "conflict" ? CircleAlert : isDirty ? Clock : CircleCheck
  const reason =
    (isDirty && disabledReason) || (localEdits && saveDisabledReason)
  // A save that can't run is left out, not greyed: the note row says why.
  const canSave = Boolean(onSave && localEdits && !saveDisabledReason)
  const saveAction: ActionBarAction = {
    label: "Save here",
    icon: <Save aria-hidden />,
    onClick: () => {
      returnFocus()
      onSave?.()
    },
    pending: saving,
    pendingLabel: "Saving…",
    describedBy: saveDescription ? saveDescriptionId : undefined,
  }

  // Secondaries are data: the ActionBar draws them inline from `md` and in
  // its overflow menu on a phone, with the same handlers and busy state.
  // With nothing to throw away or save they are left out, not greyed. With
  // nothing to publish, "Save here" is the primary instead.
  const secondaryActions: ActionBarAction[] = []
  if (canSave && isDirty) secondaryActions.push(saveAction)
  if (localEdits) {
    secondaryActions.push({
      label: "Discard edits",
      onClick: onDiscard,
      destructive: true,
    })
  }
  const primary = isDirty ? (
    <Button onClick={onReview} disabled={Boolean(disabledReason)}>
      {reviewLabel}
    </Button>
  ) : canSave ? (
    <Button
      onClick={saveAction.onClick}
      pending={saving}
      pendingLabel="Saving…"
      aria-describedby={saveAction.describedBy}
    >
      <Save aria-hidden />
      Save here
    </Button>
  ) : undefined

  return (
    <ActionBar
      data-slot="editor-footer"
      // Docked on a phone: fixed to the bottom edge, riding the keyboard,
      // the tab bar stepping aside (the primitive's docking contract). One
      // row: status, "Review changes", the overflow. The ActionBar's spacer
      // and the document's scroll padding follow its measured height, and
      // useKeepFocusClear measures the bar itself, so neither the last field
      // nor a focused one is left under it. Inline from `md`.
      dock
      sticky={false}
      safeArea={false}
      label="Editor actions"
      ref={regionRef}
      tabIndex={-1}
      // A long primary label ("Review lodging draft") would leave the status
      // no room beside it: it takes its own row then.
      statusRow={reviewLabel.length > DEFAULT_REVIEW_LABEL.length}
      // A reason the primary or Save here is blocked takes its own row under
      // the buttons, so a phone's bar is two rows only while it has one.
      className={cn(
        reason && "max-md:flex-wrap",
        "focus-visible:outline-none",
        railClass,
        className
      )}
      status={
        <>
          <StatusIcon aria-hidden />
          <span className="min-w-0">
            {/* Saving goes first so a clamped status can never cut it. */}
            {saving ? (
              <>
                <strong className="font-medium">Saving…</strong>
                <ActionBarMuted> · {headline}</ActionBarMuted>
              </>
            ) : (
              <>
                <strong className="font-medium">{headline}</strong>
                {where ? <ActionBarMuted> · {where}</ActionBarMuted> : null}
              </>
            )}
            <span className="sr-only">
              {" "}
              Nothing changes on Google until you publish.
            </span>
          </span>
        </>
      }
      secondaryActions={secondaryActions}
      primary={primary}
    >
      {/* What a partial save covers. The area header already says it as its
          model note, so here it only describes the button. */}
      {canSave && saveDescription ? (
        <span id={saveDescriptionId} className="sr-only">
          {saveDescription}
        </span>
      ) : null}
      {/* The reason only matters when there is something it is blocking. */}
      {reason ? (
        <p
          role="note"
          className="order-last w-full text-caption text-ink-muted-on-charcoal"
        >
          {reason}
        </p>
      ) : null}
    </ActionBar>
  )
}

export { EditorFooter }
