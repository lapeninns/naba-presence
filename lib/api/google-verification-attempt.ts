import { verificationAttemptResponseSchema } from "@/lib/contracts/google-verification-attempt"
import { apiFetch, type RequestOptions } from "./client"

function path(locationId: string, reviewId: string) { return `/api/locations/${locationId}/verification-reviews/${reviewId}/execute` }
export function executeGoogleVerification(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(path(locationId, reviewId), { method: "POST", body: { expectedPayloadHash, confirmation: "start_google_location_verification" }, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
export function fetchGoogleVerificationAttempt(locationId: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(path(locationId, reviewId), { ...options, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
export function refreshGoogleVerificationAttempt(locationId: string, reviewId: string) {
  return apiFetch(path(locationId, reviewId), { method: "PATCH", body: {}, schema: verificationAttemptResponseSchema }).then((result) => result.attempt)
}
