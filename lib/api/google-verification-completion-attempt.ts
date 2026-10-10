import { verificationAttemptResponseSchema } from "@/lib/contracts/google-verification-attempt"
import { apiFetch, type RequestOptions } from "./client"

function path(locationId: string, reviewId: string) { return `/api/locations/${locationId}/verification-completion-reviews/${reviewId}/execute` }
export function executeGoogleVerificationCompletion(locationId: string, reviewId: string, expectedPayloadHash: string, pin: string) {
  return apiFetch(path(locationId, reviewId), { method: "POST", body: { expectedPayloadHash, confirmation: "complete_google_location_verification", pin }, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
export function fetchGoogleVerificationCompletionAttempt(locationId: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(path(locationId, reviewId), { ...options, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
export function refreshGoogleVerificationCompletionAttempt(locationId: string, reviewId: string) {
  return apiFetch(path(locationId, reviewId), { method: "PATCH", body: {}, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
