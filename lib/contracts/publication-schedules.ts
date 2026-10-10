/**
 * Wire contract for scheduled post publication (`/api/locations/[id]/post-schedules/**`
 * and `/api/post-schedules/occurrences`). Client-safe.
 */
import { z } from "zod"

import {
  eventOffsetsSchema,
  scheduleRuleSchema,
  timezoneSchema,
} from "@/lib/domain/publication-schedule"

export const SCHEDULE_STATUSES = [
  "awaiting_approval",
  "active",
  "paused",
  "blocked",
  "cancelled",
  "completed",
] as const
export const OCCURRENCE_STATUSES = [
  "scheduled",
  "publishing",
  "published",
  "rejected",
  "ambiguous",
  "missed",
  "cancelled",
] as const

export const scheduleDraftSchema = z.strictObject({
  /** The draft post whose content is frozen into the schedule. */
  postId: z.uuid(),
  rule: scheduleRuleSchema,
  timezone: timezoneSchema.optional(),
  eventOffsets: eventOffsetsSchema.nullable().default(null),
})
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>

export const scheduleApprovalSchema = z.strictObject({
  expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(),
})
export const scheduleActionSchema = z.strictObject({
  action: z.enum(["pause", "resume", "cancel"]),
})
export const scheduleRevisionSchema = z.strictObject({
  rule: scheduleRuleSchema,
  timezone: timezoneSchema,
  eventOffsets: eventOffsetsSchema.nullable().default(null),
  /** Re-read the source draft's current content into the template. */
  refreshContent: z.boolean().default(false),
})

export const occurrenceSchema = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  intendedAt: z.iso.datetime(),
  localDate: z.string(),
  localTime: z.string(),
  timezone: z.string(),
  adjustment: z.enum(["none", "moved_forward", "earlier_of_repeated"]),
  status: z.enum(OCCURRENCE_STATUSES),
  statusReason: z.string().nullable(),
  postId: z.uuid().nullable(),
  summary: z.string(),
  topicType: z.string(),
})
export type ScheduleOccurrence = z.infer<typeof occurrenceSchema>

export const scheduleSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  status: z.enum(SCHEDULE_STATUSES),
  statusReason: z.string().nullable(),
  revision: z.number().int(),
  payloadHash: z.string(),
  rule: scheduleRuleSchema,
  timezone: z.string(),
  eventOffsets: eventOffsetsSchema.nullable(),
  template: z.object({ topicType: z.string(), summary: z.string() }).loose(),
  sourcePostId: z.uuid().nullable(),
  requestedBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  requiresSecondApprover: z.boolean(),
  canApprove: z.boolean(),
  /** The rule's full bounded expansion as the approver sees it. */
  preview: z.object({
    total: z.number().int(),
    first: z.array(
      z.object({
        intendedAt: z.string(),
        localDate: z.string(),
        localTime: z.string(),
        adjustment: z.string(),
      })
    ),
    skippedDates: z.array(z.string()),
    adjusted: z.number().int(),
  }),
  counts: z.record(z.string(), z.number()),
})
export type PublicationSchedule = z.infer<typeof scheduleSchema>

export const scheduleResponseSchema = z.object({ schedule: scheduleSchema })
export const schedulesResponseSchema = z.object({
  schedules: z.array(scheduleSchema),
})

export const occurrencesQuerySchema = z
  .strictObject({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    clientId: z.uuid().optional(),
    locationId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      Date.parse(value.to) > Date.parse(value.from) &&
      Date.parse(value.to) - Date.parse(value.from) <= 45 * 86_400_000,
    "Choose a window of up to 45 days."
  )
export const occurrencesResponseSchema = z.object({
  occurrences: z.array(occurrenceSchema),
})
