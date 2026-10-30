/**
 * Wire contract for the Google change watch (S5):
 *
 *   GET  /api/locations/{id}/google-watch             the listing's settings
 *   PUT  /api/locations/{id}/google-watch             save them (owner/admin)
 *   GET  /api/locations/{id}/google-changes           detected changes (DB only)
 *   POST /api/locations/{id}/google-changes/check     read Google now, then detect
 *   POST /api/locations/{id}/google-changes/{changeId}  "Put ours back" or
 *                                                     "Accept Google's"
 *
 * Client-safe: zod and the client-safe vocabulary only.
 *
 * INTEGRATION(S5): lib/notifications/links.ts `reviewNotificationPath`
 * should send a `listing_google_changed` notification (summary.locationId,
 * summary.changeId) to `/listings/{locationId}/suggestions`, in the inbox
 * and the email, instead of the listing overview.
 */
import { z } from "zod"

import { gbpChangeSetSchema } from "@/lib/contracts/gbp-change-set"
import { normalizedHoursSchema } from "@/lib/contracts/location-hours"
import {
  GOOGLE_CHANGE_RESOLUTIONS,
  GOOGLE_CHANGE_STATUSES,
  WATCHED_FIELDS,
} from "@/lib/domain/google-change-watch-vocabulary"

export const watchedFieldSchema = z.enum(WATCHED_FIELDS)
export const googleChangeStatusSchema = z.enum(GOOGLE_CHANGE_STATUSES)
export const googleChangeResolutionSchema = z.enum(GOOGLE_CHANGE_RESOLUTIONS)

const hashSchema = z.string().length(64)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const GOOGLE_WATCH_ALERT_MODES = [
  "managers",
  "everyone",
  "chosen",
] as const
export const googleWatchAlertModeSchema = z.enum(GOOGLE_WATCH_ALERT_MODES)
export type GoogleWatchAlertMode = z.infer<typeof googleWatchAlertModeSchema>

export const googleWatchSettingsInputSchema = z
  .object({
    protectedFields: z
      .array(watchedFieldSchema)
      .max(WATCHED_FIELDS.length)
      .refine(
        (fields) => new Set(fields).size === fields.length,
        "Each field may be listed once."
      ),
    alertMode: googleWatchAlertModeSchema,
    /** The people alerted when `alertMode` is "chosen"; ignored otherwise. */
    recipientIds: z.array(z.uuid()).max(50).default([]),
  })
  .superRefine((input, context) => {
    if (input.alertMode === "chosen" && input.recipientIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["recipientIds"],
        message: "Choose at least one person to alert.",
      })
    }
  })
export type GoogleWatchSettingsInput = z.input<
  typeof googleWatchSettingsInputSchema
>

export const googleWatchPersonSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
})
export type GoogleWatchPerson = z.infer<typeof googleWatchPersonSchema>

export const googleWatchSettingsSchema = z.object({
  protectedFields: z.array(watchedFieldSchema),
  alertMode: googleWatchAlertModeSchema,
  recipientIds: z.array(z.string()),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
})
export type GoogleWatchSettings = z.infer<typeof googleWatchSettingsSchema>

export const googleWatchSettingsResponseSchema = z.object({
  settings: googleWatchSettingsSchema,
  /** Whether the viewer may change the settings (owners and admins). */
  canManage: z.boolean(),
  /**
   * Owners and admins: everyone who can see the listing, to choose from.
   * Anyone else: only the people chosen, so they can see who is alerted.
   */
  people: z.array(googleWatchPersonSchema),
})
export type GoogleWatchSettingsResponse = z.infer<
  typeof googleWatchSettingsResponseSchema
>

// ---------------------------------------------------------------------------
// Detected changes
// ---------------------------------------------------------------------------

const categoryValueSchema = z
  .object({ name: z.string(), displayName: z.string().nullable() })
  .nullable()

/** One side of a change, in the shape the field is compared in. */
export const watchedValueSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.enum(["name", "description", "phone", "website"]),
    value: z.string().nullable(),
  }),
  z.object({ field: z.literal("primaryCategory"), value: categoryValueSchema }),
  z.object({
    field: z.literal("regularHours"),
    value: normalizedHoursSchema.shape.regular,
  }),
  z.object({
    field: z.literal("specialHours"),
    value: normalizedHoursSchema.shape.special,
  }),
])
export type WireWatchedValue = z.infer<typeof watchedValueSchema>

/** The reviewed business-information change "Put ours back" made. */
export const googleChangeRevertSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("change_set"),
    changeSet: gbpChangeSetSchema,
    /** Sent to Google (or sending): nothing left to approve or publish here. */
    dispatched: z.boolean(),
  }),
  z.object({
    kind: z.literal("change_request"),
    operationId: z.string(),
    outcome: z.string(),
  }),
])
export type GoogleChangeRevert = z.infer<typeof googleChangeRevertSchema>

export const googleChangeSchema = z.object({
  id: z.string(),
  field: watchedFieldSchema,
  status: googleChangeStatusSchema,
  resolution: googleChangeResolutionSchema.nullable(),
  ours: watchedValueSchema,
  google: watchedValueSchema,
  googleHash: z.string(),
  /** We also have edits Google has not seen; "ours" includes them. */
  localEdits: z.boolean(),
  regularDays: z.array(z.number()),
  specialDates: z.array(z.string()),
  detectedAt: z.string(),
  lastSeenAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  revert: googleChangeRevertSchema.nullable(),
})
export type GoogleChange = z.infer<typeof googleChangeSchema>

export const googleChangesResponseSchema = z.object({
  /** Live changes (open, then reverting), then the latest history. */
  changes: z.array(googleChangeSchema),
  /** Whether the viewer may put ours back or accept Google's here. */
  canDecide: z.boolean(),
  /**
   * When Google was last read for both the profile and the hours (the older
   * of the two); null until both have been read once.
   */
  lastCheckedAt: z.string().nullable(),
})
export type GoogleChangesResponse = z.infer<typeof googleChangesResponseSchema>

export const googleChangeCheckResponseSchema =
  googleChangesResponseSchema.extend({
    /** How many new changes this check found. */
    found: z.number(),
    /** Fields this check could not read from Google, so did not check. */
    unchecked: z.array(watchedFieldSchema),
  })
export type GoogleChangeCheckResponse = z.infer<
  typeof googleChangeCheckResponseSchema
>

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const googleChangeDecisionSchema = z.object({
  action: z.enum(["put_ours_back", "accept_google"]),
  /** The Google value the person saw; a different one is refused (409). */
  expectedGoogleHash: hashSchema,
})
export type GoogleChangeDecisionInput = z.infer<
  typeof googleChangeDecisionSchema
>

export const googleChangeDecisionResponseSchema = z.object({
  change: googleChangeSchema,
  /**
   * review_created: a reviewed change waits for approval and publishing.
   * awaiting_approval: the hours publish waits for a second person.
   * published: the hours are back on Google. accepted: Google's is ours now.
   */
  outcome: z.enum([
    "review_created",
    "awaiting_approval",
    "published",
    "accepted",
  ]),
})
export type GoogleChangeDecisionResponse = z.infer<
  typeof googleChangeDecisionResponseSchema
>
