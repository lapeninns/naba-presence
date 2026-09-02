import {
  encodeReviewsQuery,
  reviewDetailSchema,
  reviewsPageSchema,
  type ReviewsFilters,
} from "@/lib/contracts/reviews"

import { apiFetch, type RequestOptions } from "./client"

// Schemas and types live in the contract; re-exported so existing consumers
// (`components/inbox/*`, `lib/inbox/*`, `lib/queries/*`, tests) keep their
// import path.
export {
  latestVerificationSchema,
  reviewDetailSchema,
  reviewRowSchema,
  reviewsPageSchema,
  verificationReasonSchema,
  verificationSchema,
} from "@/lib/contracts/reviews"
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
    schema: reviewsPageSchema,
    ...options,
  })
}

export function fetchReviewDetail(id: string, options?: RequestOptions) {
  return apiFetch(`/api/reviews/${id}`, { schema: reviewDetailSchema, ...options })
}
