import type { ReviewDetail } from "@/lib/contracts/reviews"

type Review = ReviewDetail["review"]

/** Who most recently did one of `actions` to this review, from its audit trail. */
export function actorFor(review: Review, actions: string[]): string | null {
  // The route orders audit rows `created_at desc`, so the array arrives
  // NEWEST-first and the first match is the most recent actor.
  for (const entry of review.timeline) {
    if (actions.includes(entry.action)) return entry.actorName ?? null
  }
  return null
}
