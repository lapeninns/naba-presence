import { apiFetch, type RequestOptions } from "./client"
import { keywordsResponseSchema } from "@/lib/contracts/analytics"

export {
  keywordRowSchema,
  keywordsResponseSchema,
  type KeywordRow,
  type KeywordsResponse,
} from "@/lib/contracts/analytics"

export function fetchKeywords(
  params: { range: string; locationId?: string },
  options?: RequestOptions
) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  return apiFetch(`/api/analytics/presence/keywords?${query}`, {
    schema: keywordsResponseSchema,
    ...options,
  })
}
