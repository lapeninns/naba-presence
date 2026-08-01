import { z } from "zod"

import { apiFetch } from "./client"

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
})

export type ReviewCounts = z.infer<typeof reviewCountsSchema>

export function fetchReviewCounts() {
  return apiFetch("/api/reviews/counts", { schema: reviewCountsSchema })
}
