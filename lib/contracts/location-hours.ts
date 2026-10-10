// Wire contract for /api/locations/[id]/hours. Client-safe: no "server-only",
// nothing from lib/server, and only the client-safe vocabulary from lib/domain
// (lib/domain/hours.ts hashes with node:crypto; see lib/domain/README.md).
import { z } from "zod"

import {
  HOURS_DRIFT_STATUSES,
  HOURS_UPDATE_MASKS,
  hoursSelectionKeys,
  type NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

export type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
export {
  HOURS_DRIFT_STATUSES,
  HOURS_UPDATE_MASKS,
  type HoursDriftStatus,
  type HoursSelection,
  type NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

// Vocabularies come from the domain; the schemas only wrap them.
export const hoursUpdateMaskSchema = z.enum(HOURS_UPDATE_MASKS)
export const hoursDriftStatusSchema = z.enum(HOURS_DRIFT_STATUSES)

const timeSchema = z.string().regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/)
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
export const hoursInputSchema = z
  .object({
    regular: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          isClosed: z.boolean(),
          periods: z.array(
            z.object({
              opensAt: timeSchema,
              closesAt: timeSchema,
              closeDayOfWeek: z.number().int().min(0).max(6).optional(),
            })
          ),
        })
      )
      .length(7),
    special: z.array(
      z.object({
        effectiveDate: z.iso.date(),
        endDate: z.iso.date().optional(),
        isClosed: z.boolean(),
        opensAt: timeSchema.nullable(),
        closesAt: timeSchema.nullable(),
      })
    ),
    moreHours: z.array(
      z.object({
        hoursTypeId: z.string().min(1).max(100),
        periods: z.array(
          z.object({
            dayOfWeek: z.number().int().min(0).max(6),
            closeDayOfWeek: z.number().int().min(0).max(6).optional(),
            opensAt: timeSchema,
            closesAt: timeSchema,
          })
        ),
      })
    ),
  })
  .superRefine((hours, context) => {
    if (
      new Set(hours.moreHours.map((entry) => entry.hoursTypeId)).size !==
      hours.moreHours.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["moreHours"],
        message: "Each service identifier must appear only once.",
      })
    }
    if (new Set(hours.regular.map((day) => day.dayOfWeek)).size !== 7) {
      context.addIssue({
        code: "custom",
        message: "Regular hours must contain each day exactly once.",
      })
    }
    for (const [index, day] of hours.regular.entries()) {
      if (day.isClosed !== (day.periods.length === 0)) {
        context.addIssue({
          code: "custom",
          path: ["regular", index],
          message:
            "Closed days cannot contain periods and open days require a period.",
        })
      }
    }
    for (const [index, period] of hours.special.entries()) {
      if (!period.isClosed && (!period.opensAt || !period.closesAt)) {
        context.addIssue({
          code: "custom",
          path: ["special", index],
          message: "Open special hours require opening and closing times.",
        })
      }
    }
  }) satisfies z.ZodType<NormalizedHours>

export const saveHoursBodySchema = z.object({
  expectedCanonicalRevision: revisionSchema,
  hours: hoursInputSchema,
})
export type SaveHoursInput = z.input<typeof saveHoursBodySchema>

function unique<T>(values: readonly T[]) {
  return new Set(values).size === values.length
}

/**
 * The parts of the saved schedule to publish (see `HoursSelection`), each
 * pinned to the Google part hash the operator reviewed (`googlePartHashes`
 * from the GET; null for a date or service Google did not have). Other parts
 * are re-read from Google at publish time and preserved, so a Google edit to
 * an unselected part does not make the review stale.
 */
export const hoursSelectionSchema = z
  .object({
    regularDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine(unique, "Each weekday may be selected once.")
      .optional(),
    specialDates: z
      .array(z.iso.date())
      .min(1)
      .max(366)
      .refine(unique, "Each date may be selected once.")
      .optional(),
    moreHoursTypes: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(50)
      .refine(unique, "Each service may be selected once.")
      .optional(),
    expectedGoogleParts: z.record(z.string(), hashSchema.nullable()),
  })
  .superRefine((selection, context) => {
    const keys = hoursSelectionKeys(selection)
    if (keys.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Select at least one day, date or service to publish.",
      })
      return
    }
    const pinned = Object.keys(selection.expectedGoogleParts).sort()
    if (pinned.join("\n") !== keys.join("\n")) {
      context.addIssue({
        code: "custom",
        path: ["expectedGoogleParts"],
        message: "Pin exactly the selected parts.",
      })
    }
  })
export type HoursSelectionInput = z.input<typeof hoursSelectionSchema>

export const publishHoursBodySchema = z.object({
  confirmation: z.literal("publish_nabapresence_hours_to_google"),
  expectedCanonicalRevision: revisionSchema,
  expectedCanonicalHash: hashSchema,
  /** Compared only for a whole-schedule publish (no `selection`). */
  expectedGoogleHash: hashSchema,
  /** For a selection: exactly the fields the selection writes. */
  approvedUpdateMask: z.array(hoursUpdateMaskSchema).min(1),
  confirmOverwriteGoogleChanges: z.boolean().default(false),
  /** Absent: the whole saved schedule replaces Google's (the default). */
  selection: hoursSelectionSchema.optional(),
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
  regular: z.array(
    z.object({
      dayOfWeek: z.number(),
      isClosed: z.boolean(),
      periods: z.array(
        z.object({
          opensAt: z.string(),
          closesAt: z.string(),
          closeDayOfWeek: z.number().optional(),
        })
      ),
    })
  ),
  special: z.array(
    z.object({
      effectiveDate: z.string(),
      endDate: z.string().optional(),
      isClosed: z.boolean(),
      opensAt: z.string().nullable(),
      closesAt: z.string().nullable(),
    })
  ),
  moreHours: z.array(
    z.object({
      hoursTypeId: z.string(),
      periods: z.array(
        z.object({
          dayOfWeek: z.number(),
          opensAt: z.string(),
          closesAt: z.string(),
          closeDayOfWeek: z.number().optional(),
        })
      ),
    })
  ),
}) satisfies z.ZodType<NormalizedHours>

export const hoursStateSchema = z.object({
  location: z.object({
    id: z.string(),
    name: z.string(),
    googleLocationName: z.string(),
    timezone: z.string(),
  }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  status: hoursDriftStatusSchema,
  canonical: normalizedHoursSchema,
  google: normalizedHoursSchema,
  canonicalHash: z.string(),
  googleHash: z.string(),
  updateMask: z.array(hoursUpdateMaskSchema),
  /** Google's hash per present part, for pinning a selective publish. */
  googlePartHashes: z.record(z.string(), z.string()).optional(),
  /**
   * Drift per differing part, when a part baseline exists. Parts left out
   * are in sync; absent entirely, only the whole `status` is known.
   */
  partStatus: z.record(z.string(), hoursDriftStatusSchema).optional(),
  warnings: z.array(z.string()),
  supportedHoursTypes: z
    .array(z.object({ hoursTypeId: z.string(), displayName: z.string() }))
    .optional(),
  reconciliationRequired: z.boolean().optional(),
  publicationBlocked: z.boolean().optional(),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  lastReconciledAt: z.string().nullable(),
  latestAttempt: z
    .object({
      id: z.string(),
      status: z.string(),
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
    })
    .nullable(),
})
export type HoursState = z.infer<typeof hoursStateSchema>

export const hoursResponseSchema = z.object({ hours: hoursStateSchema })
export type HoursResponse = z.infer<typeof hoursResponseSchema>

export const saveHoursResponseSchema = z.object({
  saved: z.literal(true),
  revision: z.string(),
})
export type SaveHoursResponse = z.infer<typeof saveHoursResponseSchema>

export const publishHoursResponseSchema = z.object({
  status: z.enum(["in_sync", "published"]),
  attemptId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type PublishHoursResponse = z.infer<typeof publishHoursResponseSchema>
