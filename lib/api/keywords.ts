import { z } from "zod"

import { apiFetch } from "./client"

export const keywordRowSchema = z.object({
  rank: z.number(),
  keyword: z.string(),
  impressions: z.number(),
  upperBound: z.number(),
  thresholded: z.boolean(),
  firstMonth: z.string(),
  latestMonth: z.string(),
})

export const keywordsResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  state: z.enum(["no_link", "ready", "unavailable", "pending", "empty"]),
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  keywords: z.array(keywordRowSchema),
  unavailableReasons: z.array(z.string()),
})

export type KeywordRow = z.infer<typeof keywordRowSchema>
export type KeywordsResponse = z.infer<typeof keywordsResponseSchema>

export function fetchKeywords(params: { range: string; locationId?: string }) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  return apiFetch(`/api/analytics/presence/keywords?${query}`, {
    schema: keywordsResponseSchema,
  })
}
