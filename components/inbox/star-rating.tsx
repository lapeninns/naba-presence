import { Star } from "lucide-react"

import { cn } from "@/lib/utils"

function ratingLabel(rating: number): string {
  return `${rating} star${rating === 1 ? "" : "s"}`
}

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
        className={cn("text-caption text-muted-foreground", className)}
      >
        No rating
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={ratingLabel(rating)}
      className={cn("inline-flex items-center gap-px", className)}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden
          className={cn(
            size === "sm" ? "size-3" : "size-3.5",
            index < rating
              ? "fill-(--rating) stroke-(--rating)"
              : "fill-transparent stroke-muted-foreground/40"
          )}
        />
      ))}
    </span>
  )
}

export { StarRating, ratingLabel }
