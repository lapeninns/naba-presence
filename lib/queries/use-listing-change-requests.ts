"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchListingChangeRequests } from "@/lib/api/listing-changes"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** The listing changes at one location waiting for a second publisher. */
export function useListingChangeRequests(
  locationId: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: queryKeys.listingChangeRequests(locationId),
    enabled: options.enabled ?? true,
    queryFn: (ctx) =>
      fetchListingChangeRequests(locationId, requestOptions(ctx)),
  })
}
