/**
 * Wire contract for `/api/clients/[clientId]/report-shares/**` and the shape
 * of the public shared report (`/share/report/[token]`).
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * params/bodies with the request schemas; `lib/api/report-shares.ts` parses
 * responses with the response schemas.
 */
import { z } from "zod"

import type { GooglePerformanceMetric } from "@/lib/domain/google-contract"

// ---------------------------------------------------------------------------
// Link lifetimes
// ---------------------------------------------------------------------------

/** How long a new link works for. Every link expires; there is no "never". */
export const REPORT_SHARE_EXPIRY_DAYS = [30, 90, 365] as const
export type ReportShareExpiryDays = (typeof REPORT_SHARE_EXPIRY_DAYS)[number]
export const DEFAULT_REPORT_SHARE_EXPIRY_DAYS: ReportShareExpiryDays = 90

export const REPORT_SHARE_EXPIRY_OPTIONS: ReadonlyArray<{
  days: ReportShareExpiryDays
  label: string
}> = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
]

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/clients/[clientId]/report-shares` body. */
export const reportShareCreateSchema = z.object({
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .default(DEFAULT_REPORT_SHARE_EXPIRY_DAYS),
})
export type ReportShareCreateInput = z.input<typeof reportShareCreateSchema>

/** DELETE `/api/clients/[clientId]/report-shares/[shareId]` params. */
export const reportShareParamsSchema = z.object({
  clientId: z.uuid(),
  shareId: z.uuid(),
})

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const REPORT_SHARE_STATUSES = ["active", "expired", "revoked"] as const
export type ReportShareStatus = (typeof REPORT_SHARE_STATUSES)[number]

/** One link as its owners see it. The token itself is never listed. */
export const reportShareSchema = z.object({
  id: z.string(),
  status: z.enum(REPORT_SHARE_STATUSES),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
  viewCount: z.number(),
})
export type ReportShare = z.infer<typeof reportShareSchema>

/** GET `/api/clients/[clientId]/report-shares` response. */
export const reportSharesResponseSchema = z.object({
  items: z.array(reportShareSchema),
})
export type ReportSharesResponse = z.infer<typeof reportSharesResponseSchema>

/**
 * POST response (201). `url` carries the token and is the only time it is
 * ever returned: only its hash is stored.
 */
export const reportShareCreatedResponseSchema = z.object({
  share: reportShareSchema,
  url: z.string(),
})
export type ReportShareCreatedResponse = z.infer<
  typeof reportShareCreatedResponseSchema
>

/** DELETE response. */
export const reportShareRevokedResponseSchema = z.object({
  revoked: z.literal(true),
})
export type ReportShareRevokedResponse = z.infer<
  typeof reportShareRevokedResponseSchema
>

// ---------------------------------------------------------------------------
// The public report
// ---------------------------------------------------------------------------

/**
 * The periods a shared report offers: the only input it takes besides the
 * token. Anything else in `?period=` reads as the default; no other query
 * parameter is read at all.
 */
export const SHARE_PERIODS = [
  { id: "28d", label: "Last 28 days", granularity: "day" },
  { id: "90d", label: "Last 90 days", granularity: "week" },
  { id: "12m", label: "Last 12 months", granularity: "month" },
] as const
export type SharePeriodId = (typeof SHARE_PERIODS)[number]["id"]
export const DEFAULT_SHARE_PERIOD: SharePeriodId = "28d"

export function parseSharePeriod(raw: unknown): SharePeriodId {
  const found = SHARE_PERIODS.find((period) => period.id === raw)
  return found ? found.id : DEFAULT_SHARE_PERIOD
}

export type SharedReplySummary = {
  reviewVolume: number
  averageRating: number | null
  responseRate: number | null
  medianFirstResponseSeconds: number | null
}

export type SharedReplyLocation = {
  name: string
  reviews: number
  averageRating: number | null
  responseRate: number | null
  medianFirstResponseSeconds: number | null
  unresolvedComplaints: number
}

/**
 * Everything the public page is given, and so everything that can reach the
 * browser. Aggregates and names of the client, its venues and the agency
 * only: no ids, no reviewers, no review or reply text, no staff, no emails,
 * no notes, no Google account details. lib/server/shared-report.ts builds it
 * field by field from the loaders' output rather than spreading it.
 */
export type SharedClientReport = {
  agencyName: string
  clientName: string
  venues: string[]
  period: {
    id: SharePeriodId
    label: string
    from: string
    to: string
    granularity: "day" | "week" | "month"
  }
  timezone: string
  generatedAt: string
  replies: {
    summary: SharedReplySummary
    previous: SharedReplySummary | null
    series: Array<{
      period: string
      reviewCount: number
      replies: number
      averageRating: number | null
    }>
    locations: SharedReplyLocation[]
    /** Google's own totals disagree with what has been collected so far. */
    incomplete: boolean
  }
  /** Null when the organisation has no Google figures for this window. */
  google: {
    from: string
    to: string
    freshThrough: string | null
    totals: Record<GooglePerformanceMetric, number>
    series: Array<{
      date: string
      metrics: Partial<Record<GooglePerformanceMetric, number>>
    }>
  } | null
}
