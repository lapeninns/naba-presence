/**
 * Wire contract for scheduled post publication (`/api/locations/[id]/post-schedules/**`
 * and `/api/post-schedules/occurrences`). Client-safe.
 */
import { z } from "zod"

import {
  eventOffsetsSchema,
  offsetMinutesSchema,
  scheduleRuleSchema,
  SLOT_PROBLEMS,
  timezoneSchema,
} from "@/lib/domain/publication-schedule"

export const SCHEDULE_STATUSES = [
  "awaiting_approval",
  "active",
  "paused",
  "blocked",
  // Quarantined for an owner's review (migration 0116): a repeating schedule
  // from before one-time became the default. Never runs; a revision or a
  // cancel is the way out.
  "needs_review",
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
  /**
   * The UTC offset of a one-time slot, required when its local time happens
   * twice (autumn back) and otherwise optional; it must match the time.
   */
  offsetMinutes: offsetMinutesSchema.nullable().default(null),
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
  offsetMinutes: offsetMinutesSchema.nullable().default(null),
  /** Re-read the source draft's current content into the template. */
  refreshContent: z.boolean().default(false),
})

export const occurrenceSchema = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  intendedAt: z.iso.datetime(),
  /** Not started by then, the occurrence is missed (intended + 5 minutes). */
  deadlineAt: z.iso.datetime(),
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
  /** The one-time slot's UTC offset; null for repeating or pre-0117 rows. */
  offsetMinutes: z.number().int().nullable(),
  eventOffsets: eventOffsetsSchema.nullable(),
  template: z.object({ topicType: z.string(), summary: z.string() }).loose(),
  sourcePostId: z.uuid().nullable(),
  /**
   * The source draft's content revision the template was frozen from
   * (P08-R4). An edit to the draft re-freezes the schedule and asks for
   * approval again; a one-time schedule publishes the draft at exactly this
   * revision. Null for a row from before 0120 that could not be bound.
   */
  sourceContentRevision: z.number().int().nullable(),
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
    /** Why a one-time slot cannot run as stored: it needs a new time. */
    problem: z.enum(SLOT_PROBLEMS).nullable(),
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

/**
 * A pre-WP7 per-post time copied for review by migration 0116
 * (`gbp_local_post_legacy_schedule`): `/api/locations/[id]/legacy-post-schedules`.
 * Nothing ever published from it. An owner or administrator either schedules
 * the post properly (which closes the review) or dismisses it.
 */
export const legacyScheduleSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  summary: z.string(),
  topicType: z.string(),
  /** The old intended instant, if one was set. */
  scheduledPublishTime: z.iso.datetime().nullable(),
  /** The old value also asked for a repeat, which is never honoured. */
  repeats: z.boolean(),
  /**
   * Whether the post is still a draft a one-time schedule can publish and
   * has no live one-time schedule already.
   */
  schedulable: z.boolean(),
  /** The post already has a live one-time schedule; dismiss the old time. */
  alreadyScheduled: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type LegacySchedule = z.infer<typeof legacyScheduleSchema>
export const legacySchedulesResponseSchema = z.object({
  legacySchedules: z.array(legacyScheduleSchema),
})
export const legacyScheduleActionSchema = z.strictObject({
  action: z.literal("dismiss"),
})
