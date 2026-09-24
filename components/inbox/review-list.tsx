"use client"

import { useEffect, useRef } from "react"
import { GlobeIcon, ImageIcon } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { StatusPill } from "@/components/ui/status-pill"
import { replyStatusPill } from "@/components/inbox/situation-tone"
import { StarRating } from "@/components/inbox/star-rating"
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { deriveReplyStatus, replyStateFromRow } from "@/lib/inbox/reply-state"
import { parseReviewText } from "@/lib/inbox/review-text"
import { cn } from "@/lib/utils"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * The way Mail dates a row: a gap for today ("4 min ago"), a date for
 * anything older, and the year only once it is not this year — so a backlog
 * from 2024 still says so instead of "2 years ago".
 */
function listTime(iso: string, timezone: string): string {
  const age = Date.now() - new Date(iso).getTime()
  if (age >= 0 && age < ONE_DAY_MS) return formatRelativeTime(iso)
  return formatDate(iso, timezone)
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
  }
  /** Called when the end of the loaded rows scrolls into view. */
  onReachEnd?: () => void
  /** Shown under the rows while the next page is on its way. */
  isLoadingMore?: boolean
}) {
  const containerRef = useRef<HTMLUListElement>(null)

  function focusRow(index: number) {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    buttons?.[index]?.focus()
  }

  // Below lg, "Back to reviews" (components/inbox/inbox-view.tsx) clears the
  // selection and closes the detail sheet; this list never unmounts, so
  // restoring focus here — to the row that was just deselected, or the
  // roving tab-stop if it's no longer in the list — mirrors that button
  // taking focus on the way into the sheet, rather than silently dropping
  // focus on the way back.
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
        // to the window; on a phone or a short window the page scrolls.
        "relative flex min-h-0 flex-1 flex-col transition-opacity duration-(--np-duration-fast) md:[@media(min-height:620px)]:overflow-y-auto",
        isRefreshing && "opacity-80"
      )}
    >
      {isRefreshing ? (
        <div
          aria-hidden
          className="pointer-events-none sticky inset-x-0 top-0 z-10 h-0.5 shrink-0 overflow-hidden bg-line"
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
          const parsed = parseReviewText(
            review.text,
            review.detectedLanguageCode
          )
          const venue = review.location.clientName
            ? `${review.location.clientName} · ${review.location.name}`
            : review.location.name

          return (
            <li
              key={review.id}
              className={cn(
                "group/row relative flex border-b border-line transition-[background-color] duration-(--np-duration-fast) ease-out-strong",
                selected ? "bg-accent-tint" : "hover-fine:hover:bg-surface-alt",
                // The one accent in the list: a tint and a 3px bar down the
                // selected row's leading edge (reference `.rv[aria-current]`).
                selected &&
                  "before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-[3px] before:bg-primary before:content-['']"
              )}
            >
              {selection ? (
                // Always visible, never hover-only: a touch screen has no
                // hover, and a keyboard user needs to see what they tick. Its
                // own column, not laid over the row, so the box and the row
                // are two targets with room between them.
                <span className="flex w-11 shrink-0 justify-center pt-3.5">
                  <Checkbox
                    checked={selection.selected.has(review.id)}
                    aria-label={`Select the review from ${displayName}`}
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
                  void onSelect(review.id)
                }}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "relative block min-w-0 flex-1 py-3 pr-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  selection ? "pl-0" : "pl-4",
                  selected ? "bg-accent-tint" : "active:bg-surface-alt"
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <StarRating rating={review.rating} size="md" />
                    <span className="min-w-0 truncate text-ui font-semibold text-ink">
                      {displayName}
                    </span>
                    <time
                      dateTime={review.updateTime}
                      title={formatDateTime(review.updateTime, timezone)}
                      className="ml-auto shrink-0 font-mono text-[11.5px] whitespace-nowrap text-ink-muted tabular-nums"
                    >
                      {listTime(review.updateTime, timezone)}
                    </time>
                  </span>

                  <span
                    lang={parsed?.bodyLang ?? undefined}
                    dir="auto"
                    className={cn(
                      "mt-[3px] line-clamp-2 text-ui",
                      parsed ? "text-ink-secondary" : "text-ink-muted italic"
                    )}
                  >
                    {parsed?.body ?? "A rating with no written review."}
                  </span>

                  <span className="mt-[7px] flex min-w-0 flex-wrap items-center gap-2">
                    {/* Client first: in an agency inbox the location name
                        alone ("High Street") does not say whose business this
                        is, and replying in the wrong voice is the mistake this
                        line exists to prevent. */}
                    <span className="min-w-0 truncate text-caption text-ink-muted">
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
                    <StatusPill
                      tone={pill.tone}
                      dashed={pill.dashed}
                      // The full sentence is the accessible name, so a reader
                      // hears "Draft checked · Ready to publish" rather than
                      // the abbreviation the row has room for.
                      data-slot="reply-status"
                      data-tone={status.tone}
                      aria-label={status.text}
                    >
                      {status.short}
                    </StatusPill>
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
          className="px-3 py-2.5 text-caption text-ink-muted"
          aria-live="polite"
        >
          Loading more reviews…
        </p>
      ) : null}
    </section>
  )
}

export { ReviewList }

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
