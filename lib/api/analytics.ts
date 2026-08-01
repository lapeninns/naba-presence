import { z } from "zod"

import { apiFetch } from "./client"

export const analyticsSummarySchema = z.object({
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
})

export const analyticsLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  unresolvedComplaints: z.number(),
})

// Only the fields Home reads are validated; zod strips the endpoint's other
// keys (series, providerTotals, from/to, per-location rates) without error.
export const analyticsOverviewSchema = z.object({
  timezone: z.string(),
  summary: analyticsSummarySchema,
  locations: z.array(analyticsLocationSchema),
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type AnalyticsLocation = z.infer<typeof analyticsLocationSchema>
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

export function fetchAnalyticsOverview() {
  return apiFetch("/api/analytics/overview", {
    schema: analyticsOverviewSchema,
  })
}
