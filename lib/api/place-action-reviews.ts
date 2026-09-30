import { placeActionAttemptResponseSchema, placeActionReviewResponseSchema, type ReviewedPlaceActionRequest } from "@/lib/contracts/place-action-review"
import { placeActionWorkflowsResponseSchema } from "@/lib/contracts/place-action-workflows"
import { apiFetch, type RequestOptions } from "./client"
const base = (locationId: string) => `/api/locations/${locationId}/place-action-reviews`
export const previewPlaceActionReview = (locationId: string, request: ReviewedPlaceActionRequest) => apiFetch(base(locationId), { method: "POST", body: request, schema: placeActionReviewResponseSchema }).then((result) => result.review)
export const approvePlaceActionReview = (locationId: string, reviewId: string, expectedPayloadHash: string) => apiFetch(`${base(locationId)}/${reviewId}`, { method: "POST", body: { expectedPayloadHash }, schema: placeActionReviewResponseSchema }).then((result) => result.review)
export const sendPlaceActionReview = (locationId: string, reviewId: string, expectedPayloadHash: string) => apiFetch(`${base(locationId)}/${reviewId}/execute`, { method: "POST", body: { expectedPayloadHash }, schema: placeActionAttemptResponseSchema }).then((result) => result.attempt)
export const readPlaceActionOutcome = (locationId: string, reviewId: string) => apiFetch(`${base(locationId)}/${reviewId}/execute`, { schema: placeActionAttemptResponseSchema }).then((result) => result.attempt)
export const refreshPlaceActionOutcome = (locationId: string, reviewId: string) => apiFetch(`${base(locationId)}/${reviewId}/execute`, { method: "PATCH", body: {}, schema: placeActionAttemptResponseSchema }).then((result) => result.attempt)
export const fetchPlaceActionWorkflows = (locationId: string, cursor?: string, options?: RequestOptions) => apiFetch(`${base(locationId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { schema: placeActionWorkflowsResponseSchema, ...options })
