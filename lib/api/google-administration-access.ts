import { administrationAccessReviewResponseSchema, type AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"
import { administrationAccessAttemptResponseSchema } from "@/lib/contracts/google-administration-attempt"
import { administrationWorkflowsResponseSchema } from "@/lib/contracts/google-administration-workflows"
import { apiFetch, type RequestOptions } from "./client"

const path = (locationId: string, reviewId?: string) => `/api/locations/${locationId}/administration-access-reviews${reviewId ? `/${reviewId}` : ""}`
export function previewAdministrationAccess(locationId: string, input: AdministrationAccessRequest) {
  return apiFetch(path(locationId), { method: "POST", body: input, schema: administrationAccessReviewResponseSchema }).then((value) => value.review)
}
export function fetchAdministrationAccessReview(locationId: string, reviewId: string) {
  return apiFetch(path(locationId, reviewId), { schema: administrationAccessReviewResponseSchema }).then((value) => value.review)
}
export function approveAdministrationAccess(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(path(locationId, reviewId), { method: "POST", body: { expectedPayloadHash }, schema: administrationAccessReviewResponseSchema }).then((value) => value.review)
}
export function executeAdministrationAccess(locationId: string, reviewId: string, expectedPayloadHash: string) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { method: "POST", body: { expectedPayloadHash }, schema: administrationAccessAttemptResponseSchema }).then((value) => value.attempt)
}
export function fetchAdministrationAccessAttempt(locationId: string, reviewId: string) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { schema: administrationAccessAttemptResponseSchema }).then((value) => value.attempt)
}
export function refreshAdministrationAccessAttempt(locationId: string, reviewId: string) {
  return apiFetch(`${path(locationId, reviewId)}/execute`, { method: "PATCH", body: {}, schema: administrationAccessAttemptResponseSchema }).then((value) => value.attempt)
}
export function fetchAdministrationAccessWorkflows(locationId: string, cursor?: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${locationId}/administration-access-workflows${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { ...options, schema: administrationWorkflowsResponseSchema })
}
