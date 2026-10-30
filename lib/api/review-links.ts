import type { ReviewLinkPeriod } from "@/lib/domain/review-link"
import {
  reviewLinkResponseSchema,
  reviewLinkStatsResponseSchema,
  type ReviewLinkAction,
  type ReviewLinkCreate,
  type ReviewLinkState,
  type ReviewLinkStats,
} from "@/lib/domain/review-link-contract"

import { apiFetch, type RequestOptions } from "./client"

/**
 * The review link area's reads and writes (`/api/locations/[id]/review-link`,
 * `.../review-link/stats`). Reads are DB-only. Every write answers with the
 * whole state.
 */

const path = (locationId: string) => `/api/locations/${locationId}/review-link`

export function fetchReviewLink(
  locationId: string,
  options?: RequestOptions
): Promise<ReviewLinkState> {
  return apiFetch(path(locationId), {
    schema: reviewLinkResponseSchema,
    ...options,
  }).then((response) => response.reviewLink)
}

export function fetchReviewLinkStats(
  locationId: string,
  days: ReviewLinkPeriod,
  options?: RequestOptions
): Promise<ReviewLinkStats> {
  return apiFetch(`${path(locationId)}/stats?days=${days}`, {
    schema: reviewLinkStatsResponseSchema,
    ...options,
  }).then((response) => response.stats)
}

export function createReviewLink(
  locationId: string,
  input: ReviewLinkCreate
): Promise<ReviewLinkState> {
  return apiFetch(path(locationId), {
    method: "POST",
    body: input,
    schema: reviewLinkResponseSchema,
  }).then((response) => response.reviewLink)
}

export function updateReviewLink(
  locationId: string,
  action: ReviewLinkAction
): Promise<ReviewLinkState> {
  return apiFetch(path(locationId), {
    method: "PATCH",
    body: action,
    schema: reviewLinkResponseSchema,
  }).then((response) => response.reviewLink)
}
