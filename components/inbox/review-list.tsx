"use client"

import { useEffect, useRef, useState } from "react"
import { CircleSlashIcon, GlobeIcon, ImageIcon } from "lucide-react"

import { ReviewAvatar } from "@/components/inbox/review-avatar"
import {
  markNoReplyNeeded,
  useReviewTriage,
} from "@/components/inbox/review-triage"
import { Checkbox } from "@/components/ui/checkbox"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { Stars } from "@/components/ui/stars"
import { StatusPill } from "@/components/ui/status-pill"
import { replyStatusPill } from "@/components/inbox/situation-tone"
import { formatDate, formatDateTime } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { deriveReplyStatus, replyStateFromRow } from "@/lib/inbox/reply-state"
import { parseReviewText } from "@/lib/inbox/review-text"
import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ROW_CLASS =
  "py-3 [&_[data-slot=list-row-body]]:gap-0.5 [&_[data-slot=list-row-preview]]:text-ink-muted"

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
  const desk = useHydratedBreakpoint("desk")
  const containerRef = useRef<HTMLUListElement>(null)
  // The row whose "No reply needed" is being done: at once, with Undo in its toast.
  const [noReplyFor, setNoReplyFor] = useState<string | null>(null)

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
  // Once per selection: a refetch, the next page or any other re-render
  // with the same selection used to pull an operator who had scrolled away
  // straight back to the selected row. `reviews` stays a dependency so a
  // selection whose row arrives later (a deep link) is still brought in.
  const scrolledFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedId) {
      scrolledFor.current = undefined
      return
    }
    if (scrolledFor.current === selectedId) return
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    const index = reviews.findIndex((review) => review.id === selectedId)
    const row = buttons?.[index]
    if (!row) return
    scrolledFor.current = selectedId
    scrollIntoNearestScroller(row)
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
      {/* ListRows is a native <ul>/<li> (list/listitem roles); each row
          stays a real <button> (role button, `data-slot="review-row"`) so
          getByRole("button", { name }) works and the list satisfies
          aria-required-children. Roving tabindex lives on the buttons. The
          primitive owns the padding, the inset hairline (none under the
          selected row or the last), the hover and selected fills and the
          inset focus ring. */}
      <ListRows ref={containerRef} data-density="compact">
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

          // Needs a reply is this inbox's "unread": the primitive's weight,
          // full ink and dot. Everything already handled drops back to the
          // secondary ink. The status word stays — the dot and the weight
          // only reinforce it.
          const needsReply = status.short === "Needs reply"
          // The primitive always speaks its unread word after the name, so
          // the words are said there, once: "Needs reply" where the queue
          // drops the pill, the pill's own sentence where the pill shows —
          // and then the pill is drawn but not spoken a second time.
          const pillSpokenByTitle = needsReply && !pillRepeatsQueue
          // The tick box takes the avatar's place: on a desk always, on touch
          // only in select mode. Not mounted on touch outside select mode,
          // so nothing sits over the avatar where a tap should open the
          // row; until the client knows (null) CSS decides.
          const showControl = Boolean(
            selection && (selection.selectMode || desk !== false)
          )

          return (
            <ListRow
              key={review.id}
              render={<button type="button" data-slot="review-row" />}
              selected={selected}
              className={ROW_CLASS}
              tabIndex={isTabStop ? 0 : -1}
              onClick={() => {
                if (selection?.selectMode && tapTogglesSelection()) {
                  selection.toggle(review.id)
                  return
                }
                void onSelect(review.id)
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              // Triage from the row: a swipe on touch, the ⋯ button for
              // everyone else. Offered where the tick boxes are (not to a
              // viewer), and not while select mode is ticking rows.
              swipeActions={
                selection && !selection.selectMode
                  ? [
                      {
                        label: "No reply needed",
                        icon: <CircleSlashIcon aria-hidden />,
                        onAction: () => setNoReplyFor(review.id),
                      },
                    ]
                  : undefined
              }
              // Named per row, so a screen reader's list of buttons does not
              // repeat one name. It starts "Actions for", while the row's own
              // button starts with the reviewer's name, so a lookup by that
              // name must be anchored (/^Jordan Lee/) or it matches both. It
              // stays a tab stop: the keyboard has no other way to this menu.
              actionsLabel={`Actions for ${displayName}`}
              emphasis={needsReply ? "unread" : "read"}
              unreadLabel={pillSpokenByTitle ? status.text : "Needs reply"}
              // The non-colour half of the selection cue beside the fill
              // (the primitive has none): an ink bar down the leading edge
              // (reference `.q-item[aria-selected]`), the accent staying
              // reserved for the one action that publishes.
              wrapperClassName={cn(
                "group/review-row",
                selected &&
                  "before:absolute before:inset-y-2 before:start-0 before:z-raised before:w-0.75 before:rounded-e-full before:bg-ink before:content-['']"
              )}
              leading={
                selection?.selectMode && showControl ? null : (
                  <ReviewAvatar
                    name={displayName}
                    anonymous={review.reviewer.isAnonymous}
                    photoUrl={review.reviewer.profilePhotoUrl}
                    size="list"
                    className={
                      showControl
                        ? "desk:group-focus-within/review-row:invisible desk:group-hover/review-row:invisible"
                        : undefined
                    }
                  />
                )
              }
              leadingControl={
                selection && showControl ? (
                  // Never hover-only: a touch screen has no hover, and a
                  // keyboard user needs to see what they tick. The box is
                  // its own control outside the row's button, with the
                  // Checkbox's own 44px touch hit area.
                  <span
                    data-slot="review-row-select"
                    className={cn(
                      "size-full items-center justify-center bg-surface",
                      selection.selectMode || selection.selected.has(review.id)
                        ? "flex"
                        : "hidden desk:flex desk:opacity-0 desk:group-focus-within/review-row:opacity-100 desk:group-hover/review-row:opacity-100"
                    )}
                  >
                    <Checkbox
                      // Above ListRow's 44px overhang (QA #1): the overhang
                      // is the control wrapper's `after:`, drawn over its
                      // own children, so a tap on the box hit the wrapper
                      // and only reached the box by a forwarded click,
                      // which touch tooling (and assistive pointers) read
                      // as the row intercepting. Raised inside the wrapper's
                      // stacking context, the box and its own 44px halo
                      // are the topmost target; the overhang still passes
                      // on a press beyond them.
                      className="z-raised"
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
                ) : undefined
              }
              title={displayName}
              meta={
                // When it was written, as the detail pane says. An edit is
                // noted beside it. The exact times are spoken, not left to a
                // hover title a touch screen never shows; the title stays
                // for a mouse.
                <time dateTime={review.createTime} title={exactTime}>
                  <ListTime
                    iso={review.createTime}
                    timezone={timezone}
                    edited={edited}
                  />
                  <span className="sr-only">{exactTime}</span>
                </time>
              }
              subtitle={
                // The rating and whose business it is. Client first: in an
                // agency inbox the location name alone ("High Street") does
                // not say whose business this is, and replying in the wrong
                // voice is the mistake this line exists to prevent.
                // The venue wraps onto more lines rather than truncating
                // (QA #2): two venues of one client often share a long
                // prefix ("Journey Hospitality · Stub location …"), and an
                // ellipsis made them look the same. The line overrides the
                // subtitle slot's nowrap.
                // The status pill rides this line, at its end, only where
                // the line is at least sm (24rem) wide, a desk's list; on a
                // phone (390px leaves ~19rem) it drops under the venue, as
                // the pre-redesign row did, so the client · location gets
                // the width beside the stars. The venue takes the rest with
                // a zero basis, so it never pushes the pill down on its own.
                <span
                  data-slot="review-row-venue"
                  className="@container/venue block min-w-0 whitespace-normal"
                >
                  {/* Start-aligned, each item centred in one line's height,
                      so the stars sit on the venue's first line when it
                      wraps (QA N4), not midway down the block. */}
                  <span className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                    <span className="flex h-lh shrink-0 items-center">
                      <Stars
                        value={review.rating}
                        label={
                          review.rating === null
                            ? undefined
                            : ratingLabel(review.rating)
                        }
                      />
                    </span>
                    <span
                      data-slot="review-row-location"
                      title={venue}
                      className="min-w-0 flex-1 basis-0 wrap-break-word"
                    >
                      {venue}
                    </span>
                    {review.hasMedia ? (
                      <span className="flex h-lh shrink-0 items-center">
                        <ImageIcon
                          role="img"
                          aria-label="Has photos"
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0 text-ink-muted"
                        />
                      </span>
                    ) : null}
                    {parsed?.original ? (
                      <span className="flex h-lh shrink-0 items-center">
                        <GlobeIcon
                          role="img"
                          aria-label="Translated"
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0 text-ink-muted"
                        />
                      </span>
                    ) : null}
                    {pillRepeatsQueue ? null : (
                      <span
                        data-slot="review-row-status"
                        className="ml-auto flex shrink-0 self-center @max-sm/venue:ml-0 @max-sm/venue:basis-full"
                      >
                        <StatusPill
                          tone={pill.tone}
                          dashed={pill.dashed}
                          className="border-0 bg-transparent px-0"
                          // The full sentence is the accessible name, so a reader
                          // hears "Draft checked · Ready to publish" rather than
                          // the abbreviation the row has room for. Where the title
                          // already says it (a needs-reply row), not again.
                          data-slot="reply-status"
                          data-tone={status.tone}
                          aria-label={status.text}
                          aria-hidden={pillSpokenByTitle || undefined}
                        >
                          {status.short}
                        </StatusPill>
                      </span>
                    )}
                  </span>
                </span>
              }
              preview={
                // What they said — two lines on a phone, where the row is all
                // there is; one on a desk, beside the thread.
                <>
                  <span
                    data-slot="review-row-preview"
                    lang={parsed?.bodyLang ?? undefined}
                    dir="auto"
                    className={cn(!parsed && "text-ink-muted italic")}
                  >
                    {parsed?.body ?? "A rating with no written review."}
                  </span>
                  {/* The non-colour half of the selection cue, for
                      greyscale, forced colours and screen readers. */}
                  {selected ? (
                    <span className="sr-only">Selected review</span>
                  ) : null}
                </>
              }
            />
          )
        })}
      </ListRows>
      {noReplyFor ? (
        <RowNoReplyNeeded
          key={noReplyFor}
          reviewId={noReplyFor}
          onDone={() =>
            setNoReplyFor((current) =>
              current === noReplyFor ? null : current
            )
          }
        />
      ) : null}
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
 * A row's "No reply needed", done at once (nothing to confirm: Undo is in the
 * toast it raises, review-triage.tsx). Mounted only while one is being sent,
 * so the list itself needs no query client until a row is acted on.
 */
function RowNoReplyNeeded({
  reviewId,
  onDone,
}: {
  reviewId: string
  onDone: () => void
}) {
  const triage = useReviewTriage()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void triage.run(markNoReplyNeeded([reviewId])).finally(onDone)
  })
  return null
}

/**
 * The rows in outline while the list loads, drawn BY the row primitive
 * (`ListRow interactive={false}`) so the padding, the leading column, the
 * inset hairline and the line heights are the real rows': the avatar, the
 * name and age, the stars and venue beside the status pill, and two lines
 * of words (one on a desk). Nothing moves when the real rows replace it.
 * Shared by the list's pending state (inbox-view.tsx) and the route's
 * loading outline (app/(dashboard)/inbox/loading.tsx). Decorative: the
 * container says it is busy.
 */
function ReviewRowsSkeleton({
  rows = 6,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  rows?: number
}) {
  return (
    <div
      data-slot="review-rows-skeleton"
      className={cn("flex flex-col", className)}
      {...props}
    >
      {Array.from({ length: rows }, (_, index) => (
        <ListRow
          key={index}
          interactive={false}
          aria-hidden
          className={ROW_CLASS}
          leading={
            <Skeleton className="size-(--np-avatar-list) rounded-(--np-radius-pill)" />
          }
          title={<SkeletonLine className="h-3.5 w-32" />}
          meta={<SkeletonLine className="h-3 w-10" />}
          subtitle={<SkeletonLine className="h-3 w-40" />}
          trailing={
            <SkeletonLine className="h-(--np-pill-h) w-16 rounded-(--np-radius-pill)" />
          }
          preview={
            <>
              <SkeletonLine className="h-3 w-full" />
              <SkeletonLine className="h-3 w-2/3" />
            </>
          }
        />
      ))}
    </div>
  )
}

/** A skeleton bar that sits on a row's text line, as tall as its line box. */
function SkeletonLine({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("inline-block max-w-full align-middle", className)}
    />
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
