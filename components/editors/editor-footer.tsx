"use client"

import { useId } from "react"

import { CircleAlert, CircleCheck, Clock, Eye, Save } from "lucide-react"

import { useReportEditorStatus } from "@/components/editors/editor-status"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
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

function countWords(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"} not on Google`
}

/**
 * The one footer every location editor ends with: the dark action bar
 * (reference `.actionbar.editor-foot`), the single charcoal surface on the
 * screen, holding the action that reaches Google.
 *
 * Saving and publishing are different buttons with different words. "Save
 * here" (only where the resource keeps a NabaPresence copy) writes that copy
 * and nothing else; "Review changes" opens the sheet with the diff, and only
 * the sheet's "Publish to Google" sends anything. The status line says which
 * of the two has happened: "unsaved edits" or "saved here".
 *
 * A viewer gets the same bar with no buttons and the reason in words, so the
 * page never shows controls that can't be used without saying why.
 *
 * Phones (under 48rem): a clean editor shows no bar; with the first change
 * it docks edge to edge at the bottom of the screen (`data-docked`, so the
 * tab bar steps aside and scroll padding follows it), riding the keyboard.
 * Desk: `EditorFrame` pins it to the bottom of the scrolling pane. The
 * view-only bar is never docked: it sits inline and says why.
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
  changeCount,
  onSave,
  saving = false,
  saveDisabledReason,
  saveDescription,
  readOnlyReason,
  reviewLabel = "Review changes",
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
  /** Context shown when there is nothing to publish. */
  hint?: React.ReactNode
  className?: string
  /** How many fields differ from Google; words the status line. */
  changeCount?: number
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
}) {
  const saveDescriptionId = useId()
  const localEdits = canDiscard ?? isDirty

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
        }
  )

  if (readOnlyReason) {
    return (
      <ActionBar
        data-slot="editor-footer"
        sticky={false}
        safeArea={false}
        label="Editor actions"
        className={className}
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

  const headline =
    status === "conflict"
      ? STATUS_WORDS.conflict
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
  // Nothing to save, publish or resolve. A phone then shows no bar at all
  // (the header's pill already says where the area stands); it appears,
  // docked to the bottom edge, with the first change. The desk keeps it.
  const idle = !isDirty && !localEdits && status !== "conflict"

  return (
    <ActionBar
      data-slot="editor-footer"
      data-docked={idle ? undefined : "bottom"}
      sticky={false}
      safeArea={false}
      label="Editor actions"
      className={cn(
        idle
          ? "max-md:hidden"
          : // Docked edge to edge on a phone, riding the keyboard and
            // clearing the home indicator (the tab bar steps aside for it).
            "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-chrome max-md:gap-2 max-md:rounded-none max-md:px-3 max-md:pb-[calc(--spacing(3)+var(--np-dock-bottom))] max-md:[&>[data-slot=action-bar-actions]]:w-full",
        className
      )}
      status={
        <>
          <StatusIcon aria-hidden />
          <span className="min-w-0 max-md:truncate">
            {isDirty ? (
              <>
                <strong className="font-semibold">{headline}</strong>
                {where ? <ActionBarMuted> · {where}</ActionBarMuted> : null}
              </>
            ) : (
              (hint ?? "No unpublished changes.")
            )}
            {isDirty ? (
              <span className="sr-only">
                {" "}
                Nothing changes on Google until you publish.
              </span>
            ) : null}
          </span>
        </>
      }
      actions={
        <>
          <Button
            variant="ghost-dark"
            onClick={onDiscard}
            disabled={!localEdits}
            className="max-md:grow max-md:px-2.5"
          >
            Discard
          </Button>
          {onSave ? (
            <Button
              variant="ghost-dark"
              onClick={onSave}
              aria-describedby={saveDescription ? saveDescriptionId : undefined}
              pending={saving}
              pendingLabel="Saving…"
              disabled={!localEdits || Boolean(saveDisabledReason)}
              className="max-md:grow max-md:px-2.5"
            >
              <Save aria-hidden className="max-md:hidden" />
              Save here
            </Button>
          ) : null}
          <Button
            onClick={onReview}
            disabled={!isDirty || Boolean(disabledReason)}
            className="max-md:grow max-md:px-2.5"
          >
            {reviewLabel}
          </Button>
        </>
      }
    >
      {/* What a partial save covers. The area header already says it as its
          model note, so here it only describes the button. */}
      {onSave && saveDescription ? (
        <span id={saveDescriptionId} className="sr-only">
          {saveDescription}
        </span>
      ) : null}
      {/* The reason only matters when there is something it is blocking;
          with nothing to publish the status line already says so. */}
      {(isDirty && disabledReason) || (localEdits && saveDisabledReason) ? (
        <p
          role="note"
          className="order-last w-full text-caption text-ink-muted-on-charcoal"
        >
          {(isDirty && disabledReason) || saveDisabledReason}
        </p>
      ) : null}
    </ActionBar>
  )
}

export { EditorFooter }
