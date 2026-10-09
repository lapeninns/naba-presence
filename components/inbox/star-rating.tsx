import { Stars } from "@/components/ui/stars"

function ratingLabel(rating: number): string {
  return `${rating} star${rating === 1 ? "" : "s"}`
}

/**
 * The inbox's rating: the shared `Stars` primitive with the inbox's spoken
 * label ("4 stars"), which the list row and detail head name themselves by.
 * The empty stars are ornament, not information.
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
  return (
    <Stars
      value={rating}
      size={size === "sm" ? "sm" : "default"}
      label={rating === null ? undefined : ratingLabel(rating)}
      className={className}
    />
  )
}

export { StarRating, ratingLabel }
