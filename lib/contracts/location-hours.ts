// Wire contract for /api/locations/[id]/hours. Client-safe: no "server-only",
// nothing from lib/server, and only type imports from lib/domain (lib/domain/
// hours.ts hashes with node:crypto, which the client bundle cannot resolve).
import { z } from "zod"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import type { HoursDriftStatus, NormalizedHours } from "@/lib/domain/hours"

export type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
export type { HoursDriftStatus, NormalizedHours } from "@/lib/domain/hours"

// Vocabularies. `satisfies` rejects members the domain union does not know;
// an omitted member fails where lib/server/hours.ts assigns its domain-typed
// state to `HoursState`, so the tuples cannot drift from the domain in either
// direction.
export const HOURS_UPDATE_MASKS = [
  "regularHours",
  "specialHours",
  "moreHours",
] as const satisfies readonly GoogleHoursUpdateMask[]
export const hoursUpdateMaskSchema = z.enum(HOURS_UPDATE_MASKS)

export const hoursDriftStatusSchema = z.enum(
  ["in_sync", "core_dirty", "google_dirty", "conflict"] as const satisfies readonly HoursDriftStatus[]
)

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const revisionSchema = z.string().regex(/^\d+$/)
const hashSchema = z.string().length(64)

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * The schedule a client may save: validated HH:MM times, one entry per weekday,
 * period caps, and the cross-field rules (closed <=> no periods, open special
 * days carry both times).
 */
export const hoursInputSchema = z.object({
  regular: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    periods: z.array(z.object({ opensAt: timeSchema, closesAt: timeSchema })).max(3),
  })).length(7),
  special: z.array(z.object({
    effectiveDate: z.iso.date(),
    isClosed: z.boolean(),
    opensAt: timeSchema.nullable(),
    closesAt: timeSchema.nullable(),
  })).max(366),
  moreHours: z.array(z.object({
    hoursTypeId: z.string().min(1).max(100),
    periods: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opensAt: timeSchema,
      closesAt: timeSchema,
    })).max(21),
  })).max(20),
}).superRefine((hours, context) => {
  if (new Set(hours.regular.map((day) => day.dayOfWeek)).size !== 7) {
    context.addIssue({ code: "custom", message: "Regular hours must contain each day exactly once." })
  }
  for (const [index, day] of hours.regular.entries()) {
    if (day.isClosed !== (day.periods.length === 0)) {
      context.addIssue({ code: "custom", path: ["regular", index], message: "Closed days cannot contain periods and open days require a period." })
    }
  }
  for (const [index, period] of hours.special.entries()) {
    if (!period.isClosed && (!period.opensAt || !period.closesAt)) {
      context.addIssue({ code: "custom", path: ["special", index], message: "Open special hours require opening and closing times." })
    }
  }
}) satisfies z.ZodType<NormalizedHours>

export const saveHoursBodySchema = z.object({
  expectedCanonicalRevision: revisionSchema,
  hours: hoursInputSchema,
})
export type SaveHoursInput = z.input<typeof saveHoursBodySchema>

export const publishHoursBodySchema = z.object({
  confirmation: z.literal("publish_nabapresence_hours_to_google"),
  expectedCanonicalRevision: revisionSchema,
  expectedCanonicalHash: hashSchema,
  expectedGoogleHash: hashSchema,
  approvedUpdateMask: z.array(hoursUpdateMaskSchema).min(1),
  confirmOverwriteGoogleChanges: z.boolean().default(false),
})
export type PublishHoursBody = z.input<typeof publishHoursBodySchema>
/** What callers of `publishHours` supply; the client adds the confirmation. */
export type PublishHoursInput = Omit<PublishHoursBody, "confirmation">

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * A normalized schedule as the server reports it. Deliberately looser than
 * `hoursInputSchema`: the Google side is whatever Google holds, so it is not
 * re-validated against the save rules on read.
 */
export const normalizedHoursSchema = z.object({
  regular: z.array(z.object({
    dayOfWeek: z.number(),
    isClosed: z.boolean(),
    periods: z.array(z.object({ opensAt: z.string(), closesAt: z.string() })),
  })),
  special: z.array(z.object({
    effectiveDate: z.string(),
    isClosed: z.boolean(),
    opensAt: z.string().nullable(),
    closesAt: z.string().nullable(),
  })),
  moreHours: z.array(z.object({
    hoursTypeId: z.string(),
    periods: z.array(z.object({ dayOfWeek: z.number(), opensAt: z.string(), closesAt: z.string() })),
  })),
}) satisfies z.ZodType<NormalizedHours>

export const hoursStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string(), timezone: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  status: hoursDriftStatusSchema,
  canonical: normalizedHoursSchema,
  google: normalizedHoursSchema,
  canonicalHash: z.string(),
  googleHash: z.string(),
  updateMask: z.array(hoursUpdateMaskSchema),
  warnings: z.array(z.string()),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  lastReconciledAt: z.string().nullable(),
  latestAttempt: z.object({
    id: z.string(),
    status: z.string(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  }).nullable(),
})
export type HoursState = z.infer<typeof hoursStateSchema>

export const hoursResponseSchema = z.object({ hours: hoursStateSchema })
export type HoursResponse = z.infer<typeof hoursResponseSchema>

export const saveHoursResponseSchema = z.object({ saved: z.literal(true), revision: z.string() })
export type SaveHoursResponse = z.infer<typeof saveHoursResponseSchema>

export const publishHoursResponseSchema = z.object({
  status: z.enum(["in_sync", "published"]),
  attemptId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type PublishHoursResponse = z.infer<typeof publishHoursResponseSchema>
