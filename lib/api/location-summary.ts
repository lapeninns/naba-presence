import { apiFetch, type RequestOptions } from "@/lib/api/client"
import {
  listingSummariesResponseSchema,
  listingSummaryResponseSchema,
  type ListingSummary,
} from "@/lib/contracts/location-summary"

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
