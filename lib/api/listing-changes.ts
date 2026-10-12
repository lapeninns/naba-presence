import {
  listingChangeDecisionResponseSchema,
  listingChangeListResponseSchema,
  type ListingChangeDecisionBody,
  type ListingChangeDecisionResponse,
  type ListingChangeRequest,
} from "@/lib/contracts/listing-changes"

import { apiFetch, type MutationOptions, type RequestOptions } from "./client"

export type { ListingChangeRequest }

/**
 * `GET /api/locations/{id}/change-requests`: the listing changes waiting for
 * a second publisher's approval (two-person mode).
 */
export function fetchListingChangeRequests(
  locationId: string,
  options?: RequestOptions
): Promise<ListingChangeRequest[]> {
  return apiFetch(`/api/locations/${locationId}/change-requests`, {
    schema: listingChangeListResponseSchema,
    ...options,
  }).then((r) => r.changeRequests)
}

/** Approve (and send) or reject one change request. */
export function decideListingChangeRequest(
  locationId: string,
  changeId: string,
  body: ListingChangeDecisionBody,
  options: MutationOptions = {}
): Promise<ListingChangeDecisionResponse> {
  return apiFetch(`/api/locations/${locationId}/change-requests/${changeId}`, {
    method: "POST",
    body,
    schema: listingChangeDecisionResponseSchema,
    intentId: options.intentId,
  })
}
