export type AdjacentDirection = "next" | "prev"

/** The neighbouring review in the loaded list, or null at that end. */
export function adjacentReviewId(
  reviews: readonly { id: string }[],
  selected: string | undefined,
  direction: AdjacentDirection
): string | null {
  if (!selected || reviews.length === 0) return null
  const index = reviews.findIndex((review) => review.id === selected)
  if (index < 0) return null
  const next = direction === "next" ? index + 1 : index - 1
  return reviews[next]?.id ?? null
}

