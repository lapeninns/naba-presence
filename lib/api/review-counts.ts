import { apiFetch, type RequestOptions } from "./client"

// The schema loads on demand (see `ResponseSchema` in ./client): the shell's
// badge reads counts on every page, and the contract pulls in zod.
export type { ReviewCounts } from "@/lib/contracts/reviews"

export function fetchReviewCounts(
  scope: { locationId?: string; clientId?: string } = {},
  options?: RequestOptions
) {
  const params = new URLSearchParams()
  if (scope.locationId) params.set("location_id", scope.locationId)
  if (scope.clientId) params.set("client_id", scope.clientId)
  const query = params.size > 0 ? `?${params}` : ""
  return apiFetch(`/api/reviews/counts${query}`, {
    schema: () =>
      import("@/lib/contracts/reviews").then((m) => m.reviewCountsSchema),
    ...options,
  })
}
