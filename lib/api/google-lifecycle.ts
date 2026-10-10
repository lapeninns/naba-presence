import type { GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"
import { lifecycleAttemptResponseSchema, lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"
import { lifecycleWorkflowsResponseSchema } from "@/lib/contracts/google-lifecycle-workflows"
import { apiFetch, type RequestOptions } from "./client"

const path = (locationId: string, reviewId?: string) => `/api/locations/${locationId}/administration-lifecycle-reviews${reviewId ? `/${reviewId}` : ""}`
export function previewLifecycle(locationId: string, request: GoogleLifecycleRequest) {
  return apiFetch(path(locationId), { method: "POST", body: request, schema: lifecycleReviewResponseSchema }).then((value) => value.review)
}
export function fetchLifecycleReview(locationId: string, reviewId: string) {
  return apiFetch(path(locationId, reviewId), { schema: lifecycleReviewResponseSchema }).then((value) => value.review)
}
export function approveLifecycle(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(path(locationId, reviewId), { method: "POST", body: { expectedPayloadHash }, schema: lifecycleReviewResponseSchema }).then((value) => value.review)
}
export function executeLifecycle(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { method: "POST", body: { expectedPayloadHash }, schema: lifecycleAttemptResponseSchema }).then((value) => value.attempt)
}
export function fetchLifecycleAttempt(locationId: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { ...options, schema: lifecycleAttemptResponseSchema }).then((value) => value.attempt)
}
export function refreshLifecycleAttempt(locationId: string, reviewId: string) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { method: "PATCH", body: {}, schema: lifecycleAttemptResponseSchema }).then((value) => value.attempt)
}
export function fetchLifecycleWorkflows(locationId: string, cursor?: string, options?: RequestOptions) {
  return apiFetch(`${path(locationId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { ...options, schema: lifecycleWorkflowsResponseSchema })
}
