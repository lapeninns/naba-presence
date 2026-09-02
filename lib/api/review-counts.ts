import { reviewCountsSchema } from "@/lib/contracts/reviews"

import { apiFetch, type RequestOptions } from "./client"

export { reviewCountsSchema } from "@/lib/contracts/reviews"
export type { ReviewCounts } from "@/lib/contracts/reviews"

export function fetchReviewCounts(locationId?: string, options?: RequestOptions) {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""
  return apiFetch(`/api/reviews/counts${query}`, { schema: reviewCountsSchema, ...options })
}
