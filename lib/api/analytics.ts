import { z } from "zod"

import { apiFetch } from "./client"

export const analyticsSummarySchema = z.object({
  reviewVolume: z.number(),
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
  unresolvedComplaints: z.number(),
  verificationFailures: z.number(),
  verificationRejectionRate: z.number().nullable(),
  medianFirstResponseSeconds: z.number().nullable(),
  p95FirstResponseSeconds: z.number().nullable(),
  medianLatestEditSeconds: z.number().nullable(),
})

export const analyticsSeriesPointSchema = z.object({
  period: z.string(),
  reviewCount: z.number(),
  reviews: z.number(),
  replies: z.number(),
  averageRating: z.number().nullable(),
})

export const analyticsLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  reviews: z.number(),
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
  medianFirstResponseSeconds: z.number().nullable(),
  p95FirstResponseSeconds: z.number().nullable(),
  medianLatestEditSeconds: z.number().nullable(),
  unresolvedComplaints: z.number(),
  verificationRejectionRate: z.number().nullable(),
})

export const providerTotalsSchema = z.object({
  averageRating: z.number().nullable(),
  totalReviewCount: z.number().nullable(),
  localReviewCount: z.number(),
  divergence: z.boolean(),
})

export const analyticsOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  summary: analyticsSummarySchema,
  series: z.array(analyticsSeriesPointSchema),
  locations: z.array(analyticsLocationSchema),
  providerTotals: providerTotalsSchema,
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>
export type AnalyticsLocation = z.infer<typeof analyticsLocationSchema>
export type ProviderTotals = z.infer<typeof providerTotalsSchema>
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

export function fetchAnalyticsOverview(params?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  const query = new URLSearchParams()
  if (params?.from) query.set("from", params.from)
  if (params?.to) query.set("to", params.to)
  if (params?.granularity) query.set("granularity", params.granularity)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/analytics/overview${suffix}`, {
    schema: analyticsOverviewSchema,
  })
}
