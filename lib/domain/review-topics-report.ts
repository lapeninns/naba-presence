/**
 * The wire shape of GET /api/analytics/review-topics: the "What guests talk
 * about" report (S3). Client-safe; the route and the client fetch parse
 * through the same schema.
 */

import { z } from "zod"

import { REVIEW_TOPICS } from "@/lib/domain/review-topics"

export const reviewTopicReportQuerySchema = z.object({
  clientId: z.uuid().optional(),
  locationId: z.uuid().optional(),
})
export type ReviewTopicReportQuery = z.infer<
  typeof reviewTopicReportQuerySchema
>

const count = z.number().int().nonnegative()
const ratio = z.number().min(0).max(1).nullable()

const topicLineSchema = z.object({
  topic: z.enum(REVIEW_TOPICS),
  mentions: count,
  positive: count,
  neutral: count,
  negative: count,
  share: ratio,
  negativeShare: ratio,
  weekly: z.array(count),
  weeklyNegative: z.array(count),
})

const topicScopeSchema = z.object({
  classifiedReviews: count,
  topics: z.array(topicLineSchema),
})

export const reviewTopicReportSchema = z.object({
  /** Monday of each trend week (UTC), oldest first. */
  weeks: z.array(z.string()),
  /** Reviews with text in the window not classified yet. */
  pendingReviews: count,
  group: topicScopeSchema,
  locations: z.array(
    topicScopeSchema.extend({ locationId: z.string(), name: z.string() })
  ),
})
export type ReviewTopicReport = z.infer<typeof reviewTopicReportSchema>
