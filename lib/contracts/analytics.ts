/**
 * Wire contract for `/api/analytics/**` (overview, presence, keywords).
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * query strings with the query schemas; `lib/api/analytics.ts`,
 * `lib/api/presence.ts` and `lib/api/keywords.ts` parse responses with the
 * response schemas.
 */
import { z } from "zod"

import { GOOGLE_PERFORMANCE_METRICS } from "@/lib/domain/google-contract"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ANALYTICS_GRANULARITIES = ["day", "week", "month"] as const
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number]

export const PRESENCE_RANGES = ["28d", "90d", "12m", "18m"] as const
export type PresenceRange = (typeof PRESENCE_RANGES)[number]

export const KEYWORD_RANGES = ["1m", "6m", "12m", "18m"] as const
export type KeywordRange = (typeof KEYWORD_RANGES)[number]

/** Readiness of a presence/keywords report for the visible locations. */
export const PRESENCE_STATES = ["no_link", "ready", "unavailable", "pending", "empty"] as const
export const presenceStateSchema = z.enum(PRESENCE_STATES)
export type PresenceStatus = z.infer<typeof presenceStateSchema>

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** GET `/api/analytics/overview` query. */
export const analyticsOverviewQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  granularity: z.enum(ANALYTICS_GRANULARITIES).default("day"),
})
export type AnalyticsOverviewQuery = z.input<typeof analyticsOverviewQuerySchema>

/** GET `/api/analytics/presence` query. */
export const presenceQuerySchema = z.object({
  range: z.enum(PRESENCE_RANGES).default("28d"),
  locationId: z.uuid().optional(),
})
export type PresenceQuery = z.input<typeof presenceQuerySchema>

/** GET `/api/analytics/presence/keywords` query. */
export const keywordsQuerySchema = z.object({
  range: z.enum(KEYWORD_RANGES).default("6m"),
  locationId: z.uuid().optional(),
})
export type KeywordsQuery = z.input<typeof keywordsQuerySchema>

// ---------------------------------------------------------------------------
// Responses: overview
// ---------------------------------------------------------------------------

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
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>

export const analyticsSeriesPointSchema = z.object({
  period: z.string(),
  reviewCount: z.number(),
  reviews: z.number(),
  replies: z.number(),
  averageRating: z.number().nullable(),
})
export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>

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
export type AnalyticsLocation = z.infer<typeof analyticsLocationSchema>

export const providerTotalsSchema = z.object({
  averageRating: z.number().nullable(),
  totalReviewCount: z.number().nullable(),
  localReviewCount: z.number(),
  divergence: z.boolean(),
})
export type ProviderTotals = z.infer<typeof providerTotalsSchema>

/** GET `/api/analytics/overview` response. */
export const analyticsOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  summary: analyticsSummarySchema,
  series: z.array(analyticsSeriesPointSchema),
  locations: z.array(analyticsLocationSchema),
  providerTotals: providerTotalsSchema,
})
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

// ---------------------------------------------------------------------------
// Responses: presence
// ---------------------------------------------------------------------------

const reportLocationSchema = z.object({ id: z.string(), name: z.string() })

const metricTotalsSchema = z.object(
  Object.fromEntries(GOOGLE_PERFORMANCE_METRICS.map((m) => [m, z.number()]))
) as z.ZodType<Record<(typeof GOOGLE_PERFORMANCE_METRICS)[number], number>>

const metricPartialSchema = z.record(z.string(), z.number())

/** GET `/api/analytics/presence` response. */
export const presenceResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  to: z.string(),
  state: presenceStateSchema,
  freshThrough: z.string().nullable(),
  locations: z.array(reportLocationSchema),
  totals: metricTotalsSchema,
  series: z.array(z.object({ date: z.string(), metrics: metricPartialSchema })),
  unavailableReasons: z.array(z.string()),
  keywordsEnabled: z.boolean(),
  ingestionEnabled: z.boolean(),
})
export type PresenceResponse = z.infer<typeof presenceResponseSchema>

// ---------------------------------------------------------------------------
// Responses: keywords
// ---------------------------------------------------------------------------

export const keywordRowSchema = z.object({
  rank: z.number(),
  keyword: z.string(),
  impressions: z.number(),
  upperBound: z.number(),
  thresholded: z.boolean(),
  firstMonth: z.string(),
  latestMonth: z.string(),
})
export type KeywordRow = z.infer<typeof keywordRowSchema>

/** GET `/api/analytics/presence/keywords` response. */
export const keywordsResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  state: presenceStateSchema,
  locations: z.array(reportLocationSchema),
  keywords: z.array(keywordRowSchema),
  unavailableReasons: z.array(z.string()),
})
export type KeywordsResponse = z.infer<typeof keywordsResponseSchema>
