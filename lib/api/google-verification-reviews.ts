import { verificationReviewResponseSchema, type VerificationReviewInput } from "@/lib/contracts/google-verification-review"
import { apiFetch, type RequestOptions } from "./client"

function reviewPath(locationId: string, reviewId?: string) { return `/api/locations/${locationId}/verification-reviews${reviewId ? `/${reviewId}` : ""}` }
export function previewGoogleVerification(locationId: string, input: VerificationReviewInput) {
  return apiFetch(reviewPath(locationId), { method: "POST", body: input, schema: verificationReviewResponseSchema }).then((result) => result.review)
}
export function fetchGoogleVerificationReview(locationId: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(reviewPath(locationId, reviewId), { ...options, schema: verificationReviewResponseSchema }).then((result) => result.review)
}
export function approveGoogleVerification(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(reviewPath(locationId, reviewId), { method: "POST", body: { expectedPayloadHash }, schema: verificationReviewResponseSchema }).then((result) => result.review)
}
