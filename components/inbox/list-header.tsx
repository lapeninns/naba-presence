"use client"

import { useEffect, useRef } from "react"

import { GoogleFreshness } from "@/components/inbox/google-freshness"
import { useSelection } from "@/components/inbox/selection-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ReviewRow } from "@/lib/contracts/reviews"
import { formatNumber } from "@/lib/format"
import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { cn } from "@/lib/utils"

/**
 * The quiet head of the review list (reference `.queue` head): select all,
 * how many, and when Google was last checked.
 *
 * On a desk the select-all box is always there, beside the rows' own
 * boxes. On touch the boxes would cost every row 44px of width for a tool
 * used now and then, so they wait for select mode: "Select" turns it on.
 * While select mode is on (touch), or anything is ticked (at any width),
 * the band reads "N selected" with the one "Cancel", which ends the mode and
 * clears the selection. The selection bar below holds only the actions, so
 * there is a single way out. On a desk the band lasts only while something
 * is ticked: select mode is not a mode there (ticking a box sets it only so
 * a resize to touch is not left with invisible ticks), so unticking the last
 * row or pressing Escape returns the band to normal. Cancel hides itself
 * when it ends the selection, so focus is handed to the control that starts
 * one again (the select-all box on a desk, "Select" on touch). Viewers have
 * no bulk tools, so they get neither.
 */
function ListHeader({
  canBatch,
  reviews,
  loaded,
  countLabel,
  countAnnouncement,
  refreshed,
  clientId,
}: {
  canBatch: boolean
  /** The rows loaded so far, which is what select-all ticks. */
  reviews: ReviewRow[]
  loaded: boolean
  /** "12 reviews" / "50 reviews so far" / "Loading reviews…". */
  countLabel: string
  /** Spoken once per queue or filter change; see InboxView. */
  countAnnouncement: string
  /** "14:32", or null before the first fetch. */
  refreshed: string | null
  clientId?: string
}) {
  const selection = useSelection()
  const desk = useHydratedBreakpoint("desk")
  const selectButtonRef = useRef<HTMLButtonElement>(null)
  const selectAllRef = useRef<HTMLSpanElement>(null)
  const refocus = useRef(false)
  const ticked = reviews.filter((review) => selection.selected.has(review.id))
  const allTicked = reviews.length > 0 && ticked.length === reviews.length
  // Only a viewer who can batch ever enters select mode.
  const selectMode = canBatch && selection.selectMode
  // Selecting, by the touch mode or by ticks (a desk's boxes, select all):
  // the band says how many and offers the one Cancel.
  const selecting =
    canBatch && (ticked.length > 0 || (selection.selectMode && desk !== true))
  const mustLeaveMode =
    canBatch &&
    desk === true &&
    selection.selectMode &&
    selection.selected.size === 0
  const { setSelectMode } = selection

  // A desk has no select mode to sit in with nothing ticked (Escape and
  // unticking the last row leave it set): put the header back to normal.
  useEffect(() => {
    if (mustLeaveMode) setSelectMode(false)
  }, [mustLeaveMode, setSelectMode])

  // Cancel is drawn only while selecting, so it takes keyboard focus with
  // it. Hand it to the control that starts a selection again.
  useEffect(() => {
    if (selecting || !refocus.current) return
    refocus.current = false
    const target =
      desk === true ? selectAllRef.current : selectButtonRef.current
    ;(target ?? selectButtonRef.current)?.focus()
  }, [selecting, desk])

  return (
    <div
      data-slot="inbox-list-header"
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-3 px-(--np-page-pad-x) text-caption text-ink-muted",
        // Below the desk the page scrolls, not the list: while rows are
        // ticked the header (the count and the one Cancel) stays at the top,
        // under the app bar where there is one (phones), so the way out is
        // never scrolled off a long backlog.
        selecting &&
          "max-lg:sticky max-lg:top-0 max-lg:z-sticky max-lg:bg-surface max-md:top-[calc(var(--np-appbar-h)+var(--np-safe-top))]"
      )}
    >
      {canBatch ? (
        // The rows' leading column (ListRow's `--np-avatar-list`, at the
        // page gutter, `gap-3` to the text), only to line the box up with
        // the rows' tick boxes below it; the Checkbox's own hit area is the
        // target.
        <span
          data-slot="inbox-select-all"
          className={cn(
            "size-(--np-avatar-list) shrink-0 items-center justify-center",
            selectMode ? "flex" : "hidden desk:flex"
          )}
        >
          <Checkbox
            ref={selectAllRef}
            checked={allTicked}
            indeterminate={ticked.length > 0 && !allTicked}
            disabled={!loaded || reviews.length === 0}
            aria-label="Select every review in this view"
            onCheckedChange={(checked) => {
              if (checked) selection.replace(reviews.map((review) => review.id))
              else selection.clear()
            }}
          />
        </span>
      ) : null}
      {selecting ? (
        // The count of the selection, and the only one: the selection bar
        // holds the actions alone. It replaces the list's count while it
        // lasts.
        <span
          data-slot="inbox-selected-count"
          className="text-title font-semibold whitespace-nowrap text-ink tabular-nums"
        >
          {formatNumber(ticked.length)} selected
        </span>
      ) : (
        <span className="whitespace-nowrap tabular-nums">{countLabel}</span>
      )}
      {/* The selection's count is spoken as it changes. The region is
          always mounted, since one that appears with its words in it is
          not reliably announced. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {ticked.length > 0
          ? `${formatNumber(ticked.length)} ${ticked.length === 1 ? "review" : "reviews"} selected`
          : ""}
      </span>
      {/* The count is spoken once per queue or filter change, not again
          every time another page of rows arrives — scrolling a backlog
          used to announce "50 reviews so far", "100 reviews so far"… */}
      <span role="status" className="sr-only">
        {countAnnouncement}
      </span>
      <span aria-hidden className="flex-1" />
      <GoogleFreshness
        clientId={clientId}
        // On a phone too: members and viewers have no Sync button, so this
        // is the only sign of how fresh the list is. It steps aside for the
        // selection count, below the desk, where the width is short.
        className={cn("min-w-0 truncate", selecting && "max-desk:hidden")}
      />
      {loaded ? (
        // `refreshed` reads the viewer's clock, so it is null until
        // hydration. The server render holds its place with an invisible
        // same-width time; filling it in later would wrap the line and
        // push the list down.
        <span
          aria-hidden={refreshed ? undefined : true}
          className={cn(
            "sr-only tabular-nums",
            !refreshed && "invisible",
            selectMode && "hidden desk:inline"
          )}
        >
          Refreshed {refreshed ?? "00:00"}
          <span className="sr-only">
            {" "}
            from NabaPresence. Queue counts cover every review in each queue for
            the current scope.
          </span>
        </span>
      ) : null}
      {canBatch ? (
        <Button
          ref={selectButtonRef}
          variant="ghost"
          // Touch: "Select" turns select mode on. On a desk the boxes are
          // always showing, so the button is there only to cancel a
          // selection. The default size is the 44px touch control. Cancel
          // ends the mode and drops what was ticked; its name says what it
          // cancels.
          className={cn("-mr-2 px-3", !selecting && "desk:hidden")}
          aria-label={selecting ? "Cancel selection" : undefined}
          disabled={!selecting && (!loaded || reviews.length === 0)}
          onClick={() => {
            if (selecting) refocus.current = true
            selection.setSelectMode(!selecting)
          }}
        >
          {selecting ? "Cancel" : "Select"}
        </Button>
      ) : null}
    </div>
  )
}

export { ListHeader }
