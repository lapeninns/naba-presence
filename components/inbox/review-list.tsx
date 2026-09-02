"use client"

import { useEffect, useRef } from "react"
import { GlobeIcon, ImageIcon, ReplyIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

  return (
    <section
      aria-label="Review list"
      aria-busy={isRefreshing || undefined}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity duration-(--nr-duration-fast)",
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

          return (
            <li key={review.id}>
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
                  "relative flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-[colors,background-color] duration-(--nr-duration-fast) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/30",
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
                        "inline-flex shrink-0 items-center rounded-(--nr-radius-pill) px-1.5 py-px text-caption font-medium",
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
                    <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                      {formatDate(review.updateTime, timezone)}
                    </span>
                    <span
                      aria-hidden
                      className="text-caption text-muted-foreground/60"
                    >
                      ·
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                      {review.location.name}
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
                    className="line-clamp-2 text-caption text-muted-foreground"
                  >
                    {parsed?.body ?? "No review text"}
                  </span>

                  {parsed?.original ? (
                    <span className="flex items-center gap-x-2 text-caption text-muted-foreground">
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
    </section>
  )
}

export { ReviewList }
