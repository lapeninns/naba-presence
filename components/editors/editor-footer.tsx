"use client"

import { useId, useRef } from "react"

import { Eye, Save } from "lucide-react"

import { useReportEditorStatus } from "@/components/editors/editor-status"
import {
  ActionBar,
  ActionBarMuted,
  DispatchBar,
  SaveBar,
  type ActionBarAction,
} from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import { StatusGlyph } from "@/components/ui/status-glyph"
import { describeOutcome, statusText } from "@/lib/editors/outcome"
import { useReturnFocus } from "@/lib/editors/use-return-focus"
import { cn } from "@/lib/utils"

export type EditorStatus =
  "in_sync" | "edited" | "unpublished" | "google_dirty" | "conflict"

const DEFAULT_REVIEW_LABEL = "Review changes"

/** The dispatch bar's sub-line: nothing has left NabaPresence yet. */
const NOT_SENT_YET = "Nothing changes on Google until you publish."

/**
 * The dispatch bar's lifecycle state and headline, in the shared words
 * (DIRECTION §6.1): edits only in this tab are "unsaved", a difference
 * NabaPresence already holds is a "draft saved" here, and a copy Google
 * changed meanwhile is "changed on Google".
 */
function dispatchState({
  status,
  localEdits,
  changeCount,
}: {
  status: EditorStatus
  localEdits: boolean
  changeCount?: number
}) {
  const n =
    typeof changeCount === "number" && changeCount > 0 ? changeCount : undefined
  if (status === "conflict" || status === "google_dirty")
    return {
      state: "conflict" as const,
      title: describeOutcome("conflict").label,
      detail: describeOutcome("conflict").title,
    }
  if (localEdits)
    return {
      state: "unsaved" as const,
      title: statusText(describeOutcome("unsaved").title, { n }),
    }
  return {
    state: "saved_locally" as const,
    title: n
      ? statusText("{n} changes saved here, not on Google", { n })
      : describeOutcome("saved_locally").title,
  }
}

/**
 * The one footer every location editor ends with. With something to
 * publish it is the charcoal DISPATCH BAR (reference `.actionbar.editor-foot`),
 * the single charcoal surface on the screen, whose on-dark "Review changes"
 * leads to the sheet's `send` publish; with local edits that already match
 * Google it is the surface SAVE BAR.
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
 * "Save here" is the primary. The status line is the lifecycle state in the
 * shared words: "N unsaved changes" (only in this tab), "N changes saved
 * here, not on Google" or "Google changed this since you saved it", each with
 * its glyph; while a save runs it leads with
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
    // Nothing here is bound for Google, so it is a surface bar.
    return (
      <ActionBar
        tone="surface"
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

  const shared = {
    "data-slot": "editor-footer",
    // Docked on a phone: fixed to the bottom edge, riding the keyboard,
    // the tab bar stepping aside (the primitive's docking contract). One
    // row: status, the primary, the overflow. The ActionBar's spacer and
    // the document's scroll padding follow its measured height, and
    // useKeepFocusClear measures the bar itself, so neither the last field
    // nor a focused one is left under it. Inline from `md`.
    dock: true,
    sticky: false,
    safeArea: false,
    label: "Editor actions",
    ref: regionRef,
    tabIndex: -1,
    secondaryActions,
    // A reason the primary or Save here is blocked takes its own row under
    // the buttons, so a phone's bar is two rows only while it has one.
    className: cn(
      reason && "max-md:flex-wrap",
      "focus-visible:outline-none",
      railClass,
      className
    ),
  }

  const notes = (
    <>
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
          className="order-last w-full text-caption text-ink-muted-on-charcoal in-data-[bar-tone=surface]:text-ink-muted"
        >
          {reason}
        </p>
      ) : null}
    </>
  )

  if (isDirty) {
    // The dispatch bar: something here is bound for Google. "Review
    // changes" only opens the review sheet and writes nothing, so it is the
    // light on-charcoal button; the send fill waits for the sheet's publish.
    const dispatch = dispatchState({ status, localEdits, changeCount })
    return (
      <DispatchBar
        {...shared}
        state={dispatch.state}
        // Saving goes first so a clamped status can never cut it.
        title={saving ? "Saving…" : dispatch.title}
        detail={
          saving
            ? dispatch.title
            : "detail" in dispatch
              ? dispatch.detail
              : NOT_SENT_YET
        }
        // A long primary label ("Review lodging draft") would leave the
        // status no room beside it: it takes its own row then.
        statusRow={reviewLabel.length > DEFAULT_REVIEW_LABEL.length}
        primary={
          <Button
            variant="on-dark"
            onClick={onReview}
            disabled={Boolean(disabledReason)}
          >
            {reviewLabel}
          </Button>
        }
      >
        {notes}
      </DispatchBar>
    )
  }

  const primary = canSave ? (
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

  if (localEdits) {
    // Local edits that already match Google: a save keeps them here, and
    // there is nothing to publish, so this is the surface save bar.
    return (
      <SaveBar
        {...shared}
        saving={saving}
        detail="No changes to publish: they match Google."
        primary={primary}
      >
        {notes}
      </SaveBar>
    )
  }

  // A conflict with nothing here to send: Google changed its copy since
  // this one was saved. A read, not a send, so a surface bar.
  const conflict = describeOutcome("conflict")
  return (
    <ActionBar
      {...shared}
      tone="surface"
      data-state="conflict"
      status={
        <>
          <StatusGlyph glyph={conflict.glyph} className="text-warning-ink" />
          <span
            data-slot="action-bar-status-text"
            className="flex min-w-0 flex-col"
          >
            <span data-slot="action-bar-status-title" className="font-semibold">
              {conflict.label}
            </span>
            <ActionBarMuted data-slot="action-bar-status-detail">
              {conflict.title}
            </ActionBarMuted>
          </span>
        </>
      }
      primary={primary}
    >
      {notes}
    </ActionBar>
  )
}

export { EditorFooter }
