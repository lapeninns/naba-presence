/**
 * Wire contract for listing completeness:
 *   GET    /api/listings/summary?view=completeness[&locationId=<uuid>]
 *   GET    /api/locations/[id]/completeness-skips
 *   POST   /api/locations/[id]/completeness-skips   { checkId, reason }
 *   DELETE /api/locations/[id]/completeness-skips?checkId=<id>
 *
 * Client-safe: no `server-only`, no `lib/server` imports.
 */
import { z } from "zod"

import {
  COMPLETENESS_CHECK_IDS,
  COMPLETENESS_IMPORTANCE,
  COMPLETENESS_STATUSES,
} from "@/lib/listings/completeness"

export const completenessCheckIdSchema = z.enum(COMPLETENESS_CHECK_IDS)

export const completenessCheckSchema = z.object({
  id: completenessCheckIdSchema,
  title: z.string(),
  importance: z.enum(COMPLETENESS_IMPORTANCE),
  status: z.enum(COMPLETENESS_STATUSES),
  detail: z.string(),
  fix: z.object({ label: z.string(), href: z.string() }).nullable(),
  skip: z.object({ reason: z.string(), skippedAt: z.string() }).optional(),
})

export const listingCompletenessSchema = z.object({
  locationId: z.string(),
  score: z.number().int().min(0).max(100).nullable(),
  fixPoints: z.number().int().nonnegative(),
  counts: z.object({
    fail: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    not_applicable: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  checks: z.array(completenessCheckSchema),
})

export const listingCompletenessResponseSchema = z.object({
  completeness: z.array(listingCompletenessSchema),
})
export type ListingCompletenessResponse = z.infer<
  typeof listingCompletenessResponseSchema
>

export const COMPLETENESS_SKIP_REASON_MAX = 500

export const completenessSkipSchema = z.object({
  checkId: completenessCheckIdSchema,
  reason: z.string(),
  skippedAt: z.string(),
  /** Who skipped it, by display name; null once their account is gone. */
  skippedBy: z.string().nullable(),
})
export type CompletenessSkipRecord = z.infer<typeof completenessSkipSchema>

export const completenessSkipsResponseSchema = z.object({
  skips: z.array(completenessSkipSchema),
})
export type CompletenessSkipsResponse = z.infer<
  typeof completenessSkipsResponseSchema
>

export const completenessSkipInputSchema = z.object({
  checkId: completenessCheckIdSchema,
  reason: z
    .string()
    .trim()
    .min(1, "Say why this check doesn’t apply.")
    .max(
      COMPLETENESS_SKIP_REASON_MAX,
      `Keep the reason under ${COMPLETENESS_SKIP_REASON_MAX} characters.`
    ),
})
export type CompletenessSkipInput = z.infer<typeof completenessSkipInputSchema>

export const completenessSkipCreatedResponseSchema = z.object({
  skip: completenessSkipSchema,
})

export const completenessSkipRemovedResponseSchema = z.object({
  removed: z.boolean(),
})
