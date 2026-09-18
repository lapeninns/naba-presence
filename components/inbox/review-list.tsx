"use client"

import { useEffect, useRef } from "react"
import { ChevronRightIcon, GlobeIcon, ImageIcon } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { ReplyStatusLine } from "@/components/inbox/detail/reply-status-line"
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
    buttons?.[index]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
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
      aria-label="Review list"
      aria-busy={isRefreshing || undefined}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity duration-(--np-duration-fast)",
        isRefreshing && "opacity-80"
      )}
    >
      {isRefreshing ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-line-subtle"
        >
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}
      {/* Native <ul>/<li> give the list/listitem roles; the row stays a real
          <button> (role button) so getByRole("button", { name }) works and the
          list satisfies aria-required-children. Roving tabindex lives on the
          buttons. Compact density: a working queue is read, not browsed. */}
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
              className="group/row relative border-b border-line-subtle last:border-b-0"
            >
              {selection ? (
                <span
                  className={cn(
                    "absolute top-3 left-2.5 z-10 flex transition-opacity duration-(--np-duration-fast)",
                    // Visible once ticked or on hover/focus, so an untouched
                    // list is not a wall of empty boxes — but never hidden
                    // from keyboards, which have no hover.
                    selection.selected.has(review.id)
                      ? "opacity-100"
                      : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100"
                  )}
                >
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
                // Four lines, one voice: who and when, where and how many
                // stars, a line of what they said, and the one status. The
                // avatar is gone — a monogram of the reviewer's initials is
                // the least useful thing in a queue where every row is a
                // different stranger, and its 28px bought a longer venue name.
                className={cn(
                  // The halo is inset because the list clips at the card's
                  // corners; an outer halo would be cut off on the edge rows.
                  "relative block w-full rounded-(--np-radius-control) border px-2.5 py-2.5 text-left transition-[background-color,border-color] duration-(--np-duration-fast) ease-spring-snappy focus-visible:[box-shadow:inset_var(--np-focus-halo)] focus-visible:outline-none",
                  selection ? "pl-8" : "pl-2.5",
                  selected
                    ? // A neutral fill and a real edge rather than the accent
                      // tint: in a list of forty, colour is how an exception
                      // gets noticed, and spending it on "this is the one you
                      // are reading" leaves nothing for the rows that need it.
                      // The chevron at the end carries the same meaning
                      // without relying on either.
                      "border-(--np-line-strong) bg-fill-secondary"
                    : "border-transparent hover:bg-(--np-hover-bg) active:bg-fill-tertiary"
                )}
              >
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-body text-ink",
                        selected ? "font-semibold" : "font-medium"
                      )}
                    >
                      {displayName}
                    </span>
                    <time
                      dateTime={review.updateTime}
                      title={formatDateTime(review.updateTime, timezone)}
                      className="shrink-0 text-caption text-ink-muted tabular-nums"
                    >
                      {listTime(review.updateTime, timezone)}
                    </time>
                  </span>

                  <span className="flex items-center justify-between gap-2 text-caption text-ink-muted">
                    {/* Client first: in an agency inbox the location name
                        alone ("High Street") does not say whose business this
                        is, and replying in the wrong voice is the mistake this
                        line exists to prevent. */}
                    <span className="min-w-8 flex-1 truncate">{venue}</span>
                    {review.hasMedia ? (
                      <ImageIcon
                        role="img"
                        aria-label="Has photos"
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0"
                      />
                    ) : null}
                    <StarRating rating={review.rating} tone="neutral" />
                  </span>

                  {/* One line, not two. The full text is in the pane a click
                      away, and a queue that a person scans is better served by
                      forty first lines than twenty first paragraphs. */}
                  <span
                    lang={parsed?.bodyLang ?? undefined}
                    dir="auto"
                    className={cn(
                      // The `text-ui` role already carries its own line
                      // height; the `--leading-ui` token it used to name here
                      // does not exist, so the utility resolved to nothing.
                      "truncate text-ui",
                      selected ? "text-ink" : "text-ink-muted"
                    )}
                  >
                    {parsed?.body ?? "A rating with no written review."}
                  </span>

                  <span className="flex items-center justify-end gap-1.5">
                    {parsed?.original ? (
                      <span className="mr-auto flex items-center gap-1.5 text-caption text-ink-muted">
                        <GlobeIcon
                          aria-hidden
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0"
                        />
                        Translated
                      </span>
                    ) : null}
                    <ReplyStatusLine status={status} variant="row" />
                    {/* The non-colour half of the selection cue: a selected row
                        is the only one with a chevron, so it is still
                        identifiable in greyscale, in forced colours, and to
                        anyone who cannot separate the fill from the surface. */}
                    {selected ? (
                      <>
                        <ChevronRightIcon
                          aria-hidden
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0 text-ink"
                        />
                        <span className="sr-only">Selected review</span>
                      </>
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
