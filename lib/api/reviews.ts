import { encodeReviewsQuery } from "@/lib/contracts/review-values"
import type { ReviewsFilters } from "@/lib/contracts/reviews"

import { apiFetch, type RequestOptions } from "./client"

// Types live in the contract; re-exported so existing consumers
// (`components/inbox/*`, `lib/inbox/*`, `lib/queries/*`, tests) keep their
// import path. The response schemas load on demand (see `ResponseSchema` in
// ./client) so zod and the contract stay out of the inbox's first load;
// import a schema from `@/lib/contracts/reviews` where one is needed.
export type {
  LatestVerification,
  ReviewCapabilities,
  ReviewDetail,
  ReviewRow,
  ReviewsFilters,
  ReviewsPage,
  Verification,
  VerificationReason,
} from "@/lib/contracts/reviews"

export function fetchReviews(
  filters: ReviewsFilters,
  cursor: string | null,
  options?: RequestOptions
) {
  const query = encodeReviewsQuery({ ...filters, cursor }).toString()
  return apiFetch(query ? `/api/reviews?${query}` : "/api/reviews", {
    schema: () =>
      import("@/lib/contracts/reviews").then((m) => m.reviewsPageSchema),
    ...options,
  })
}

export function fetchReviewDetail(id: string, options?: RequestOptions) {
  return apiFetch(`/api/reviews/${id}`, {
    schema: () =>
      import("@/lib/contracts/reviews").then((m) => m.reviewDetailSchema),
    ...options,
  })
}
