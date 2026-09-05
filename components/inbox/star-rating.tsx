import { Star } from "lucide-react"

import { cn } from "@/lib/utils"

function ratingLabel(rating: number): string {
  return `${rating} star${rating === 1 ? "" : "s"}`
}

/**
 * Five stars, the filled ones in the rating amber. The group is one image
 * with a spoken label ("4 stars"); the empty stars are drawn in the
 * quaternary ink because they are ornament, not information.
 */
function StarRating({
  rating,
  size = "sm",
  className,
}: {
  rating: number | null
  size?: "sm" | "md"
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
              ? "fill-(--np-rating) stroke-(--np-rating)"
              : "fill-transparent stroke-ink-quaternary"
          )}
        />
      ))}
    </span>
  )
}

export { StarRating, ratingLabel }
