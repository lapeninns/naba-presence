"use client"

import { useEffect, useRef } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { formatDate } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function stars(rating: number | null): string {
  return rating === null ? "No rating" : `${rating} star${rating === 1 ? "" : "s"}`
}

function ReviewList({
  reviews,
  selectedId,
  onSelect,
  timezone = "Europe/London",
}: {
  reviews: ReviewRow[]
  selectedId: string | undefined
  // Returns whether the selection actually changed: `false` means the
  // dirty guard blocked it (the user cancelled the discard confirm). Arrow
  // navigation below relies on this so a blocked selection change never
  // moves DOM focus onto a row whose tabIndex is still -1, which would
  // desync the roving-tabindex invariant from the visible selection.
  onSelect: (id: string) => boolean
  timezone?: string
}) {
  const containerRef = useRef<HTMLUListElement>(null)

  function focusRow(index: number) {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    buttons?.[index]?.focus()
  }

  // Below xl, "Back to reviews" (components/inbox/inbox-view.tsx) clears the
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

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowDown" && index < reviews.length - 1) {
      event.preventDefault()
      if (onSelect(reviews[index + 1].id)) focusRow(index + 1)
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault()
      if (onSelect(reviews[index - 1].id)) focusRow(index - 1)
    }
  }

  const activeIndex = reviews.findIndex((review) => review.id === selectedId)

  return (
    <section
      aria-label="Review list"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
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
          return (
            <li key={review.id}>
              <button
                type="button"
                data-slot="review-row"
                aria-current={selected ? "true" : undefined}
                tabIndex={isTabStop ? 0 : -1}
                onClick={() => onSelect(review.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors duration-(--nr-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  selected ? "bg-muted" : "hover:bg-muted/60"
                )}
              >
                <Avatar>
                  <AvatarFallback>
                    {initials(review.reviewer.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-ui font-medium">
                      {review.reviewer.isAnonymous
                        ? "Anonymous"
                        : (review.reviewer.displayName ?? "Anonymous")}
                    </span>
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {formatDate(review.updateTime, timezone)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-caption text-muted-foreground">
                    <span aria-label={stars(review.rating)}>
                      {review.rating === null ? "—" : "★".repeat(review.rating)}
                    </span>
                    <span className="truncate">{review.location.name}</span>
                  </span>
                  <span
                    lang={review.detectedLanguageCode ?? undefined}
                    dir="auto"
                    className="line-clamp-2 text-caption text-muted-foreground"
                  >
                    {review.text ?? "No review text"}
                  </span>
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
