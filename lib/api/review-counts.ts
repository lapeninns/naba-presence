import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
})

export type ReviewCounts = z.infer<typeof reviewCountsSchema>

export function fetchReviewCounts(locationId?: string, options?: RequestOptions) {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""
  return apiFetch(`/api/reviews/counts${query}`, { schema: reviewCountsSchema, ...options })
}
