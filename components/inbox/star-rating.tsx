import { Star } from "lucide-react"

import { cn } from "@/lib/utils"

function ratingLabel(rating: number): string {
  return `${rating} star${rating === 1 ? "" : "s"}`
}

/**
 * Five stars as one image with a spoken label ("4 stars"); the empty stars are
 * ornament, not information.
 *
 * `tone="neutral"` draws them in ink rather than the rating amber. In a queue
 * of forty rows the amber was the loudest thing on screen, competing with the
 * one control that should be shouting — the primary action — and with the
 * exceptions that genuinely need a colour. The rating is still the second word
 * of every row's accessible name, so nothing is lost by letting it be quiet.
 */
function StarRating({
  rating,
  size = "sm",
  tone = "rating",
  className,
}: {
  rating: number | null
  size?: "sm" | "md"
  tone?: "rating" | "neutral"
  className?: string
}) {
  if (rating === null) {
    return (
      <span
        aria-label="No rating"
        className={cn("text-caption text-ink-muted", className)}
      >
        No rating
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={ratingLabel(rating)}
      className={cn("inline-flex shrink-0 items-center gap-px", className)}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            size === "sm" ? "size-3" : "size-3.5",
            index < rating
              ? tone === "neutral"
                ? "fill-current stroke-current text-ink-muted"
                : "fill-(--np-rating) stroke-(--np-rating)"
              : tone === "neutral"
                ? "fill-transparent stroke-(--np-line-strong)"
                : "fill-transparent stroke-ink-quaternary"
          )}
        />
      ))}
    </span>
  )
}

export { StarRating, ratingLabel }
