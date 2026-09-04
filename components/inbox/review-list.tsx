"use client"

import { useEffect, useRef } from "react"
import { GlobeIcon, ImageIcon, ReplyIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { StarRating } from "@/components/inbox/star-rating"
import { SITUATION_TONE_CHIP } from "@/components/inbox/situation-tone"
import { formatDate } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { situationFromReviewRow } from "@/lib/inbox/review-situation"
import { parseReviewText } from "@/lib/inbox/review-text"
import { cn } from "@/lib/utils"

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function ReviewList({
  reviews,
  selectedId,
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
  // selection and swaps this pane back into view; this list panel itself
  // never unmounts (it's only CSS-hidden while the detail pane shows), so
  // restoring focus here — to the row that was just deselected, or the
  // roving tab-stop if it's no longer in the list — mirrors that button
  // moving focus into the detail pane on the way there, rather than
  // silently dropping focus on the way back.
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
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-border/40"
        >
          <div className="h-full w-1/3 animate-pulse bg-primary/70" />
        </div>
      ) : null}
      {/* Native <ul>/<li> give the list/listitem roles; the row stays a real
          <button> (role button) so getByRole("button", { name }) works and the
          list satisfies aria-required-children. Roving tabindex lives on the
          buttons. */}
      <ul ref={containerRef} className="flex flex-col">
        {reviews.map((review, index) => {
          const selected = review.id === selectedId
          // Roving tabindex: the selected row is the tab stop; if nothing is
          // selected the first row is, so the list is reachable by keyboard.
          const isTabStop = selected || (activeIndex === -1 && index === 0)
          const displayName = review.reviewer.isAnonymous
            ? "Anonymous"
            : (review.reviewer.displayName ?? "Anonymous")
          const photoUrl =
            !review.reviewer.isAnonymous && review.reviewer.profilePhotoUrl
              ? review.reviewer.profilePhotoUrl
              : null
          const situation = situationFromReviewRow(review)
          const parsed = parseReviewText(
            review.text,
            review.detectedLanguageCode
          )
          const hasIcons =
            review.hasMedia || review.replyStatus === "published"
          // --muted-foreground is calibrated against the page/card surface
          // (6.24:1 in dark); on the selected row's --accent tint it drops to
          // 4.48:1, just under AA. The selected row therefore softens the
          // row's OWN foreground instead — 5.7:1 on the tint in dark, 5.6:1
          // in light — which keeps the secondary/primary hierarchy without
          // failing contrast. (The `·` separators stay muted: they are
          // aria-hidden decoration, not text a reader has to make out.)
          const secondaryText = selected
            ? "text-foreground/70"
            : "text-muted-foreground"

          return (
            <li key={review.id} className="relative">
              {selection ? (
                <span
                  className={cn(
                    "absolute top-3.5 left-3 z-10 transition-opacity duration-(--np-duration-fast)",
                    // Visible once ticked or on hover/focus, so an untouched
                    // list is not a wall of empty boxes — but never hidden
                    // from keyboards, which have no hover.
                    selection.selected.has(review.id)
                      ? "opacity-100"
                      : "opacity-0 focus-within:opacity-100 group-hover/row:opacity-100"
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
                className={cn(
                  "group/row relative flex w-full items-start gap-3 border-b border-border/60 py-3 pr-4 text-left transition-[colors,background-color] duration-(--np-duration-fast) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/30",
                  selection ? "pl-10" : "pl-4",
                  selected
                    ? // Accent tint (Google pale blue) is the sanctioned
                      // selection surface; the 2px leading bar in
                      // accent-foreground disambiguates selection from hover
                      // without relying on colour alone.
                      "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-foreground/70 before:content-['']"
                    : "hover:bg-muted/60"
                )}
              >
                <Avatar className="mt-0.5">
                  {photoUrl ? (
                    <AvatarImage src={photoUrl} alt="" />
                  ) : null}
                  <AvatarFallback>{initials(displayName)}</AvatarFallback>
                </Avatar>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-ui font-medium">
                      {displayName}
                    </span>
                    <span
                      title={situation.headline}
                      aria-label={situation.headline}
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-(--np-radius-pill) px-1.5 py-px text-caption font-medium",
                        SITUATION_TONE_CHIP[situation.tone]
                      )}
                    >
                      {situation.chip}
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5">
                    <StarRating rating={review.rating} />
                    <span
                      aria-hidden
                      className="text-caption text-muted-foreground/60"
                    >
                      ·
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-caption tabular-nums",
                        secondaryText
                      )}
                    >
                      {formatDate(review.updateTime, timezone)}
                    </span>
                    <span
                      aria-hidden
                      className="text-caption text-muted-foreground/60"
                    >
                      ·
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-caption",
                        secondaryText
                      )}
                    >
                      {/* Client first: in an agency inbox the location name
                          alone ("High Street") does not say whose business
                          this is, and replying in the wrong voice is the
                          mistake this line exists to prevent. */}
                      {review.location.clientName
                        ? `${review.location.clientName} · ${review.location.name}`
                        : review.location.name}
                    </span>
                    {hasIcons ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {review.hasMedia ? (
                          <ImageIcon
                            role="img"
                            aria-label="Has photos"
                            className="size-3.5 text-muted-foreground"
                          />
                        ) : null}
                        {review.replyStatus === "published" ? (
                          <ReplyIcon
                            role="img"
                            aria-label="Reply published"
                            className="size-3.5 text-success"
                          />
                        ) : null}
                      </span>
                    ) : null}
                  </span>

                  <span
                    lang={parsed?.bodyLang ?? undefined}
                    dir="auto"
                    className={cn("line-clamp-2 text-caption", secondaryText)}
                  >
                    {parsed?.body ?? "No review text"}
                  </span>

                  {parsed?.original ? (
                    <span
                      className={cn(
                        "flex items-center gap-x-2 text-caption",
                        secondaryText
                      )}
                    >
                      <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
                      Translated
                    </span>
                  ) : null}
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
        <p className="px-4 py-3 text-caption text-ink-muted" aria-live="polite">
          Loading more reviews…
        </p>
      ) : null}
    </section>
  )
}

export { ReviewList }
