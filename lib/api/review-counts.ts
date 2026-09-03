import { reviewCountsSchema } from "@/lib/contracts/reviews"

import { apiFetch, type RequestOptions } from "./client"

export { reviewCountsSchema } from "@/lib/contracts/reviews"
export type { ReviewCounts } from "@/lib/contracts/reviews"

export function fetchReviewCounts(
  scope?: string | { locationId?: string; clientId?: string; groupBy?: "client" },
  options?: RequestOptions
) {
  // Accepts the legacy positional location id as well as a scope object, so
  // existing callers keep working while the inbox rail moves to clients.
  const params = new URLSearchParams()
  const scoped = typeof scope === "string" ? { locationId: scope } : (scope ?? {})
  if (scoped.locationId) params.set("location_id", scoped.locationId)
  if (scoped.clientId) params.set("client_id", scoped.clientId)
  if (scoped.groupBy) params.set("group_by", scoped.groupBy)
  const query = params.size > 0 ? `?${params}` : ""
  return apiFetch(`/api/reviews/counts${query}`, { schema: reviewCountsSchema, ...options })
}
