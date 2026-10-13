"use client"

import { useEffect, useRef } from "react"
import { GlobeIcon, ImageIcon } from "lucide-react"

import { ReviewAvatar } from "@/components/inbox/review-avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { Stars } from "@/components/ui/stars"
import { StatusPill } from "@/components/ui/status-pill"
import { replyStatusPill } from "@/components/inbox/situation-tone"
import { formatDate, formatDateTime } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { deriveReplyStatus, replyStateFromRow } from "@/lib/inbox/reply-state"
import { parseReviewText } from "@/lib/inbox/review-text"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Where a row's inset hairline starts: the text column, past the avatar
 * (32px, `size-8`) and the gap beside it (`gap-3`) — from the page gutter
 * when the row starts there, or from the 44px tick-box column (`w-11`)
 * when that is drawn. Written from the same tokens the row is laid out
 * with, so the line follows them.
 */
const ROW_INSET_AFTER_GUTTER =
  "after:left-[calc(var(--np-page-pad-x)+--spacing(8)+--spacing(3))]"
const ROW_INSET_AFTER_COLUMN =
  "after:left-[calc(--spacing(11)+--spacing(8)+--spacing(3))]"
const DESK_ROW_INSET_AFTER_COLUMN =
  "desk:after:left-[calc(--spacing(11)+--spacing(8)+--spacing(3))]"

/**
 * The status words a queue already says. A row in Needs reply that reads
 * "Needs reply" repeats the tab above it and pushes the pills that DO carry
 * news ("Check needed", "Ready to publish") into the same grey.
 */
const QUEUE_SAYS: Record<string, readonly string[]> = {
  needs_reply: ["Needs reply"],
  // Only the aggregate tab: under "Waiting on: Me / Others" the pill still
  // says whose turn it is, which the tab does not.
  approval: ["Awaiting approval"],
  publishing: ["Publishing"],
  failed: ["Publish failed"],
  done: ["Replied"],
}

/**
 * Google moves a review's update time when the reviewer edits it. A minute's
 * grace, so a create and a first sync a moment apart do not read as an edit.
 */
export function wasEdited(createTime: string, updateTime: string): boolean {
  return Date.parse(updateTime) - Date.parse(createTime) > 60_000
}

/**
 * The way Mail dates a row: a gap for today ("4 min ago"), a date for
 * anything older, and the year only once it is not this year — so a backlog
 * from 2024 still says so instead of "2 years ago".
 */
function ListTime({
  iso,
  timezone,
  edited,
}: {
  iso: string
  timezone: string
  edited: boolean
}) {
  return (
    <RelativeTime
      as="span"
      aria-hidden
      iso={iso}
      within={{ ms: ONE_DAY_MS, otherwise: formatDate(iso, timezone) }}
      suffix={edited ? " · edited" : ""}
    />
  )
}

/** The rating as the row names it: "4 stars", "1 star". */
function ratingLabel(rating: number): string {
  return `${rating} star${rating === 1 ? "" : "s"}`
}

/**
 * Whether a tap on a row should tick it rather than open it: only while
 * select mode is on, and only where select mode is a touch gesture — a
 * coarse pointer, or a viewport too narrow for the split view. Read when the
 * row is tapped, never subscribed to, because nothing about the drawing
 * depends on it.
 */
function tapTogglesSelection(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    !window.matchMedia(mediaQuery("lg")).matches
  )
}

function ReviewList({
  ref,
  reviews,
  selectedId,
  queue,
  onSelect,
  onMovePastEnd,
  timezone = "Europe/London",
  isRefreshing = false,
  selection,
  onReachEnd,
  isLoadingMore = false,
}: {
  /** The scrolling element, so the parent can keep its place. */
  ref?: React.Ref<HTMLElement>
  reviews: ReviewRow[]
  selectedId: string | undefined
  /**
   * The queue these rows were fetched under. Only used to say who an approval
   * is waiting on, and only when the server scoped it — see `replyStateFromRow`.
   */
  queue?: string
  // Returns whether the selection actually changed: `false` means the
  // dirty guard blocked it (the user cancelled the discard confirm). Arrow
  // navigation below relies on this so a blocked selection change never
  // moves DOM focus onto a row whose tabIndex is still -1, which would
  // desync the roving-tabindex invariant from the visible selection.
  onSelect: (id: string) => boolean | Promise<boolean>
  /** Arrow past the first/last visible row — parent pages or fetches. */
  onMovePastEnd?: (direction: "next" | "prev") => void
  timezone?: string
  /** Soft cue while a background refetch keeps previous rows visible. */
  isRefreshing?: boolean
  /** Bulk selection. Omitted on surfaces where batching makes no sense. */
  selection?: {
    selected: ReadonlySet<string>
    toggle: (id: string) => void
    extendTo: (id: string) => void
    /**
     * Touch select mode (components/inbox/selection-context.tsx). A desk
     * always shows the tick boxes; touch shows them only while this is on,
     * and then a tap on a row ticks it instead of opening it.
     */
    selectMode: boolean
  }
  /** Called when the end of the loaded rows scrolls into view. */
  onReachEnd?: () => void
  /** Shown under the rows while the next page is on its way. */
  isLoadingMore?: boolean
}) {
  const business = useWorkspaceMode() === "business"
  const containerRef = useRef<HTMLUListElement>(null)

  function focusRow(index: number) {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    buttons?.[index]?.focus()
  }

  // Below the split view, the detail's back control
  // (components/inbox/inbox-view.tsx) clears the selection and closes the
  // review; this list never unmounts, so restoring focus here — to the row
  // that was just deselected, or the roving tab-stop if it's no longer in
  // the list — mirrors the back control taking focus on the way into the
  // review, rather than silently dropping focus on the way back.
  const previouslySelectedId = useRef(selectedId)
  useEffect(() => {
    if (previouslySelectedId.current && !selectedId) {
      const index = reviews.findIndex(
        (review) => review.id === previouslySelectedId.current
      )
      focusRow(index >= 0 ? index : 0)
    }
    previouslySelectedId.current = selectedId
  }, [selectedId, reviews])

  // Keep the selected row in view when selection changes (keyboard, auto-
  // select, or deep link) without fighting intentional scroll while paging.
  useEffect(() => {
    if (!selectedId) return
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    const index = reviews.findIndex((review) => review.id === selectedId)
    const row = buttons?.[index]
    if (row) scrollIntoNearestScroller(row)
  }, [selectedId, reviews])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowDown" && index < reviews.length - 1) {
      event.preventDefault()
      void Promise.resolve(onSelect(reviews[index + 1].id)).then((ok) => {
        if (ok) focusRow(index + 1)
      })
    } else if (event.key === "ArrowDown" && index === reviews.length - 1) {
      event.preventDefault()
      onMovePastEnd?.("next")
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault()
      void Promise.resolve(onSelect(reviews[index - 1].id)).then((ok) => {
        if (ok) focusRow(index - 1)
      })
    } else if (event.key === "ArrowUp" && index === 0) {
      event.preventDefault()
      onMovePastEnd?.("prev")
    } else if (event.key === "Home" && reviews.length > 0) {
      event.preventDefault()
      void Promise.resolve(onSelect(reviews[0].id)).then((ok) => {
        if (ok) focusRow(0)
      })
    } else if (event.key === "End" && reviews.length > 0) {
      event.preventDefault()
      const last = reviews.length - 1
      void Promise.resolve(onSelect(reviews[last].id)).then((ok) => {
        if (ok) focusRow(last)
      })
    }
  }

  const activeIndex = reviews.findIndex((review) => review.id === selectedId)

  // Loading the next page as the end comes into view, rather than paging
  // seven rows at a time over a fifty-row window. The visible "Load more"
  // button below is not a fallback for slow connections — it is the keyboard
  // and screen-reader path, since an observer that fires on scroll never
  // fires for someone tabbing through rows.
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !onReachEnd) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReachEnd()
      },
      { rootMargin: "200px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [onReachEnd])

  return (
    <section
      ref={ref}
      aria-label="Review list"
      aria-busy={isRefreshing || undefined}
      className={cn(
        // The rows scroll inside the card only where the workspace is locked
        // to the window (the split view, on a window tall enough for it); on
        // a phone, a tablet or a short window the page scrolls.
        "relative flex min-h-0 flex-1 flex-col transition-opacity duration-(--np-duration-fast) lg:[@media(min-height:620px)]:overflow-y-auto",
        isRefreshing && "opacity-80"
      )}
    >
      {isRefreshing ? (
        <div
          aria-hidden
          className="pointer-events-none sticky inset-x-0 top-0 z-sticky h-0.5 shrink-0 overflow-hidden bg-line"
        >
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}
      {/* Native <ul>/<li> give the list/listitem roles; the row stays a real
          <button> (role button) so getByRole("button", { name }) works and the
          list satisfies aria-required-children. Roving tabindex lives on the
          buttons. */}
      <ul ref={containerRef} data-density="compact" className="flex flex-col">
        {reviews.map((review, index) => {
          const selected = review.id === selectedId
          // Roving tabindex: the selected row is the tab stop; if nothing is
          // selected the first row is, so the list is reachable by keyboard.
          const isTabStop = selected || (activeIndex === -1 && index === 0)
          const displayName = review.reviewer.isAnonymous
            ? "Anonymous"
            : (review.reviewer.displayName ?? "Anonymous")
          const status = deriveReplyStatus(replyStateFromRow(review, queue))
          const pill = replyStatusPill(status)
          const pillRepeatsQueue = Boolean(
            queue && QUEUE_SAYS[queue]?.includes(status.short)
          )
          const edited = wasEdited(review.createTime, review.updateTime)
          const parsed = parseReviewText(
            review.text,
            review.detectedLanguageCode
          )
          const exactTime = edited
            ? `Written ${formatDateTime(review.createTime, timezone)}, edited ${formatDateTime(review.updateTime, timezone)}`
            : `Written ${formatDateTime(review.createTime, timezone)}`
          const venue =
            review.location.clientName && !business
              ? `${review.location.clientName} · ${review.location.name}`
              : review.location.name

          // Needs a reply is this inbox's "unread": the name and the words
          // in full ink with a dot after the name. Everything already handled
          // drops back to the secondary ink. The status word stays — the dot
          // and the weight only reinforce it.
          const needsReply = status.short === "Needs reply"
          // Whether the tick-box column is drawn: then the row starts at the
          // avatar, flush with the column; otherwise at the page gutter.
          const selectColumn = selection
            ? selection.selectMode
              ? "always"
              : "desk"
            : "never"

          return (
            <li
              key={review.id}
              data-slot="review-row-item"
              className={cn(
                "group/row relative flex transition-[background-color] duration-(--np-duration-fast) ease-out-strong",
                selected ? "bg-fill" : "hover-fine:hover:bg-surface-alt",
                // The selected row is raised with an ink bar down its leading
                // edge (reference `.q-item[aria-selected]`): the accent stays
                // reserved for the one action that publishes.
                selected &&
                  "before:absolute before:inset-y-2 before:left-0 before:z-raised before:w-0.75 before:rounded-r-full before:bg-ink before:content-['']",
                // An inset hairline from the text column to the gutter: past
                // the avatar (and the tick-box column where it shows), so the
                // rows read as one list rather than a stack of boxes. Not
                // under the selected row, whose fill already separates it,
                // nor under the last.
                !selected &&
                  "after:pointer-events-none after:absolute after:right-(--np-page-pad-x) after:bottom-0 after:h-px after:bg-line-subtle after:content-[''] last:after:hidden",
                !selected &&
                  (selectColumn === "always"
                    ? ROW_INSET_AFTER_COLUMN
                    : selectColumn === "desk"
                      ? cn(ROW_INSET_AFTER_GUTTER, DESK_ROW_INSET_AFTER_COLUMN)
                      : ROW_INSET_AFTER_GUTTER)
              )}
            >
              {selection ? (
                // Never hover-only: a touch screen has no hover, and a
                // keyboard user needs to see what they tick. Always there on
                // a desk; on touch only in select mode, so the row keeps its
                // width until the operator asks to batch. Its own 44px
                // column, not laid over the row, so the box and the row are
                // two targets — and the whole column is the box's target:
                // the box is `static` and its hit-area pseudo-element fills
                // the column, so a tap anywhere in it is a tap on the box.
                <span
                  data-slot="review-row-select"
                  className={cn(
                    "relative w-11 shrink-0 justify-center pt-3.5 desk:pt-3",
                    selection.selectMode ? "flex" : "hidden desk:flex"
                  )}
                >
                  <Checkbox
                    checked={selection.selected.has(review.id)}
                    aria-label={`Select the review from ${displayName}`}
                    className="static after:inset-0"
                    onClick={(event) => {
                      if ((event as React.MouseEvent).shiftKey) {
                        selection.extendTo(review.id)
                        return
                      }
                      selection.toggle(review.id)
                    }}
                  />
                </span>
              ) : null}
              <button
                type="button"
                data-slot="review-row"
                aria-current={selected ? "true" : undefined}
                tabIndex={isTabStop ? 0 : -1}
                onClick={() => {
                  if (selection?.selectMode && tapTogglesSelection()) {
                    selection.toggle(review.id)
                    return
                  }
                  void onSelect(review.id)
                }}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "relative block min-w-0 flex-1 py-3 pr-(--np-page-pad-x) text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring desk:py-2.5",
                  selectColumn === "always"
                    ? "pl-0"
                    : selectColumn === "desk"
                      ? "pl-(--np-page-pad-x) desk:pl-0"
                      : "pl-(--np-page-pad-x)",
                  selected ? "bg-fill" : "active:bg-surface-alt"
                )}
              >
                <span
                  data-slot="review-row-content"
                  className="flex items-start gap-3"
                >
                  <ReviewAvatar
                    name={displayName}
                    anonymous={review.reviewer.isAnonymous}
                    photoUrl={review.reviewer.profilePhotoUrl}
                    size="default"
                  />
                  <span
                    data-slot="review-row-copy"
                    // The row's own width, for the one narrow-screen rule
                    // below (the status pill takes its own line).
                    className="@container/row flex min-w-0 flex-1 flex-col"
                  >
                    {/* L1: who, the reply-needed dot, and when. */}
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "min-w-0 truncate text-body",
                          needsReply
                            ? "font-semibold text-ink"
                            : "font-normal text-ink-secondary"
                        )}
                      >
                        {displayName}
                      </span>
                      {needsReply ? (
                        <>
                          <span
                            aria-hidden
                            data-slot="review-row-indicator"
                            className="size-1.5 shrink-0 rounded-(--np-radius-pill) bg-info-solid"
                          />
                          {/* Spoken only where the pill is not: in the Needs
                            reply queue the pill would repeat the tab, so the
                            row drops it, but the dot alone is not words. */}
                          {pillRepeatsQueue ? (
                            <span className="sr-only">Needs reply</span>
                          ) : null}
                        </>
                      ) : null}
                      {/* When it was written, as the detail pane says — the two
                        used to disagree, one showing the edit and the other
                        the original. An edit is noted beside it. The exact
                        times are spoken, not left to a hover title a touch
                        screen never shows; the title stays for a mouse. */}
                      <time
                        dateTime={review.createTime}
                        title={exactTime}
                        className="ml-auto shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums"
                      >
                        <ListTime
                          iso={review.createTime}
                          timezone={timezone}
                          edited={edited}
                        />
                        <span className="sr-only">{exactTime}</span>
                      </time>
                    </span>

                    {/* L2: the rating, whose business it is, and the status
                      at the trailing end. The pill takes its own line only
                      where the row is too narrow to share it (a sub-360px
                      screen), so the venue is never squeezed to nothing. */}
                    <span
                      data-slot="review-row-venue"
                      className="flex min-h-(--np-pill-h) min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <Stars
                          value={review.rating}
                          label={
                            review.rating === null
                              ? undefined
                              : ratingLabel(review.rating)
                          }
                        />
                        {/* Client first: in an agency inbox the location name
                          alone ("High Street") does not say whose business
                          this is, and replying in the wrong voice is the
                          mistake this line exists to prevent. */}
                        <span
                          data-slot="review-row-location"
                          title={venue}
                          className="min-w-0 truncate text-caption text-ink-muted"
                        >
                          {venue}
                        </span>
                        {review.hasMedia ? (
                          <ImageIcon
                            role="img"
                            aria-label="Has photos"
                            strokeWidth={1.75}
                            className="size-3.5 shrink-0 text-ink-muted"
                          />
                        ) : null}
                        {parsed?.original ? (
                          <GlobeIcon
                            role="img"
                            aria-label="Translated"
                            strokeWidth={1.75}
                            className="size-3.5 shrink-0 text-ink-muted"
                          />
                        ) : null}
                      </span>
                      {pillRepeatsQueue ? null : (
                        <span className="ml-auto flex shrink-0 @max-2xs/row:ml-0 @max-2xs/row:basis-full">
                          <StatusPill
                            tone={pill.tone}
                            dashed={pill.dashed}
                            // The full sentence is the accessible name, so a
                            // reader hears "Draft checked · Ready to publish"
                            // rather than the abbreviation the row has room
                            // for.
                            data-slot="reply-status"
                            data-tone={status.tone}
                            aria-label={status.text}
                          >
                            {status.short}
                          </StatusPill>
                        </span>
                      )}
                    </span>

                    {/* L3: what they said — two lines on a phone, where the
                      row is all there is; one beside the thread, where the
                      full words are a glance away. */}
                    <span
                      data-slot="review-row-preview"
                      lang={parsed?.bodyLang ?? undefined}
                      dir="auto"
                      className={cn(
                        "mt-0.5 line-clamp-2 text-ui lg:line-clamp-1",
                        !parsed
                          ? "text-ink-muted italic"
                          : needsReply
                            ? "text-ink"
                            : "text-ink-secondary"
                      )}
                    >
                      {parsed?.body ?? "A rating with no written review."}
                    </span>
                    {/* The non-colour half of the selection cue, for
                      greyscale, forced colours and screen readers. */}
                    {selected ? (
                      <span className="sr-only">Selected review</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {onReachEnd ? (
        <div ref={sentinelRef} aria-hidden className="h-px shrink-0" />
      ) : null}
      {isLoadingMore ? (
        <p
          className="px-(--np-page-pad-x) py-2.5 text-caption text-ink-muted"
          aria-live="polite"
        >
          Loading more reviews…
        </p>
      ) : null}
    </section>
  )
}

/**
 * The rows in outline while the list loads, at the rows' own geometry (the
 * gutter or the tick-box column, the 32px avatar, then the name and age, the
 * stars and venue at the status pill's height, and two lines of words — one
 * from lg), so nothing moves when the real rows replace it. Shared by the
 * list's pending state (inbox-view.tsx) and the route's loading outline
 * (app/(dashboard)/inbox/loading.tsx). Decorative: the container says it is
 * busy.
 */
function ReviewRowsSkeleton({
  rows = 6,
  selectColumn = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  rows?: number
  /** Leave the desk's 44px tick-box column, as rows for a batcher do. */
  selectColumn?: boolean
}) {
  return (
    <div className={cn("flex flex-col", className)} {...props}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className={cn(
            "relative flex items-start gap-3 py-3 pr-(--np-page-pad-x) pl-(--np-page-pad-x) desk:py-2.5",
            selectColumn && "desk:pl-11",
            "after:absolute after:right-(--np-page-pad-x) after:bottom-0 after:h-px after:bg-line-subtle after:content-[''] last:after:hidden",
            selectColumn
              ? cn(ROW_INSET_AFTER_GUTTER, DESK_ROW_INSET_AFTER_COLUMN)
              : ROW_INSET_AFTER_GUTTER
          )}
        >
          <Skeleton className="size-8 shrink-0 rounded-(--np-radius-pill)" />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-(--text-body--line-height) items-center gap-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="ml-auto h-3 w-10" />
            </div>
            <div className="flex h-(--np-pill-h) items-center gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="ml-auto h-3 w-16" />
            </div>
            <div className="mt-0.5 flex h-(--text-ui--line-height) items-center">
              <Skeleton className="h-3 w-11/12" />
            </div>
            <div className="flex h-(--text-ui--line-height) items-center lg:hidden">
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export { ReviewList, ReviewRowsSkeleton }

/**
 * Bring a row into view by scrolling only its nearest scrolling container,
 * and only when it is actually out of view. `scrollIntoView` scrolls every
 * scrollable ancestor too, so auto-selecting the first review on a desktop
 * load also scrolled the page column and slid the org-wide reconnect banner
 * under the sticky toolbar.
 */
function scrollIntoNearestScroller(row: HTMLElement) {
  let scroller = row.parentElement
  while (scroller) {
    const overflow = getComputedStyle(scroller).overflowY
    if (
      (overflow === "auto" || overflow === "scroll") &&
      scroller.scrollHeight > scroller.clientHeight
    ) {
      break
    }
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const rowBox = row.getBoundingClientRect()
  const box = scroller.getBoundingClientRect()
  const delta =
    rowBox.top < box.top
      ? rowBox.top - box.top
      : rowBox.bottom > box.bottom
        ? rowBox.bottom - box.bottom
        : 0
  if (delta !== 0) scroller.scrollBy?.({ top: delta, behavior: "smooth" })
}
