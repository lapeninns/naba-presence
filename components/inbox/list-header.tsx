"use client"

import { GoogleFreshness } from "@/components/inbox/google-freshness"
import { useSelection } from "@/components/inbox/selection-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ReviewRow } from "@/lib/contracts/reviews"
import { cn } from "@/lib/utils"

/**
 * The quiet head of the review list (reference `.queue` head): select all,
 * how many, and when the list was fetched.
 *
 * On a desk the select-all box is always there, beside the rows' own
 * boxes. On touch the boxes would cost every row 44px of width for a tool
 * used now and then, so they wait for select mode: "Select" turns it on,
 * "Done" turns it off (and clears the selection). Viewers have no bulk
 * tools, so they get neither.
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
  const ticked = reviews.filter((review) => selection.selected.has(review.id))
  const allTicked = reviews.length > 0 && ticked.length === reviews.length

  return (
    <div
      data-slot="inbox-list-header"
      className="flex min-h-11 shrink-0 items-center gap-2.5 border-b border-line px-3 text-caption text-ink-muted"
    >
      {canBatch ? (
        // A 44px column only to line the box up with the rows' checkbox
        // column below it; the Checkbox's own hit area is the target.
        <span
          data-slot="inbox-select-all"
          className={cn(
            "-ml-3 w-11 shrink-0 items-center justify-center",
            selection.selectMode ? "flex" : "hidden desk:flex"
          )}
        >
          <Checkbox
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
      <span className="whitespace-nowrap tabular-nums">{countLabel}</span>
      {/* The count is spoken once per queue or filter change, not again
          every time another page of rows arrives — scrolling a backlog
          used to announce "50 reviews so far", "100 reviews so far"… */}
      <span role="status" className="sr-only">
        {countAnnouncement}
      </span>
      <span aria-hidden className="flex-1" />
      <GoogleFreshness
        clientId={clientId}
        className="min-w-0 truncate max-2xl:hidden"
      />
      {loaded ? (
        // `refreshed` reads the viewer's clock, so it is null until
        // hydration. The server render holds its place with an invisible
        // same-width time; filling it in later would wrap the line and
        // push the list down.
        <span
          aria-hidden={refreshed ? undefined : true}
          className={cn(
            "whitespace-nowrap tabular-nums",
            !refreshed && "invisible"
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
          variant="ghost"
          // Touch only: on a desk the boxes are always showing. The default
          // size is the 44px touch control.
          className="-mr-2 px-3 desk:hidden"
          disabled={!selection.selectMode && (!loaded || reviews.length === 0)}
          onClick={() => selection.setSelectMode(!selection.selectMode)}
        >
          {selection.selectMode ? "Done" : "Select"}
        </Button>
      ) : null}
    </div>
  )
}

export { ListHeader }
