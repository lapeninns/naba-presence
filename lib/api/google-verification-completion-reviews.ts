import { verificationCompletionReviewResponseSchema, type VerificationCompletionInput } from "@/lib/contracts/google-verification-completion-review"
import { apiFetch, type RequestOptions } from "./client"

function reviewPath(locationId: string, reviewId?: string) { return `/api/locations/${locationId}/verification-completion-reviews${reviewId ? `/${reviewId}` : ""}` }
export function previewGoogleVerificationCompletion(locationId: string, input: VerificationCompletionInput) {
  return apiFetch(reviewPath(locationId), { method: "POST", body: input, schema: verificationCompletionReviewResponseSchema }).then((result) => result.review)
}
export function fetchGoogleVerificationCompletionReview(locationId: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(reviewPath(locationId, reviewId), { ...options, schema: verificationCompletionReviewResponseSchema }).then((result) => result.review)
}
export function approveGoogleVerificationCompletion(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(reviewPath(locationId, reviewId), { method: "POST", body: { expectedPayloadHash }, schema: verificationCompletionReviewResponseSchema }).then((result) => result.review)
}
