import { apiFetch, type RequestOptions } from "@/lib/api/client"
import {
  listingSummariesResponseSchema,
  listingSummaryResponseSchema,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import type { ListingCompleteness } from "@/lib/listings/completeness"
import {
  completenessSkipCreatedResponseSchema,
  completenessSkipRemovedResponseSchema,
  listingCompletenessResponseSchema,
  type CompletenessSkipInput,
} from "@/lib/listings/completeness-contract"

export function fetchListingSummary(
  id: string,
  options?: RequestOptions
): Promise<ListingSummary> {
  return apiFetch(`/api/locations/${id}/summary`, {
    schema: listingSummaryResponseSchema,
    ...options,
  }).then((response) => response.summary)
}

export function fetchListingSummaries(
  options?: RequestOptions
): Promise<ListingSummary[]> {
  return apiFetch("/api/listings/summary", {
    schema: listingSummariesResponseSchema,
    ...options,
  }).then((response) => response.summaries)
}

/**
 * Completeness checks (`?view=completeness`): every visible listing's, or
 * one listing's with `locationId`. DB-only, like the summaries.
 */
export function fetchListingCompleteness(
  locationId?: string,
  options?: RequestOptions
): Promise<ListingCompleteness[]> {
  const query = new URLSearchParams({ view: "completeness" })
  if (locationId) query.set("locationId", locationId)
  return apiFetch(`/api/listings/summary?${query}`, {
    schema: listingCompletenessResponseSchema,
    ...options,
  }).then((response) => response.completeness)
}

export function skipCompletenessCheck(
  locationId: string,
  input: CompletenessSkipInput
) {
  return apiFetch(`/api/locations/${locationId}/completeness-skips`, {
    method: "POST",
    body: input,
    schema: completenessSkipCreatedResponseSchema,
  })
}

export function unskipCompletenessCheck(locationId: string, checkId: string) {
  const query = new URLSearchParams({ checkId })
  return apiFetch(`/api/locations/${locationId}/completeness-skips?${query}`, {
    method: "DELETE",
    schema: completenessSkipRemovedResponseSchema,
  })
}
