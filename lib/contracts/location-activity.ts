/**
 * Wire contract for GET `/api/locations/[id]/activity`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the route
 * (query schema), `lib/api/location-activity.ts` (response schema) and
 * `lib/server/location-activity.ts` (the item/state types).
 */
import { z } from "zod"
import { encodeCursor, decodeCursor } from "./cursor"
import { gbpExecutionStateSchema, gbpConfirmationStateSchema } from "./gbp-management"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * GET `/activity` query (`pageSize` arrives as a string). Paging is by keyset
 * cursor only: a `page` from a client older than that is accepted and
 * ignored, so it reads the first page rather than failing.
 */
export const locationActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  cursor: z.string().max(1024).optional(),
})
export type LocationActivityQuery = z.infer<typeof locationActivityQuerySchema>

/**
 * The position after the last row of a page: newest first by
 * (`created_at`, prefixed id). Bound to its location; the server refuses it
 * anywhere else (400 `invalid_cursor`).
 */
export const locationActivityCursorSchema = z
  .object({
    version: z.literal(1),
    locationId: z.uuid(),
    at: z.iso.datetime(),
    id: z
      .string()
      .regex(
        /^(management|hours|profile|menus|links|media|posts|reviews):[0-9a-f-]{36}$/
      ),
  })
  .strict()
export type LocationActivityCursor = z.infer<
  typeof locationActivityCursorSchema
>

export function encodeLocationActivityCursor(
  cursor: LocationActivityCursor
): string {
  return encodeCursor(cursor)
}

export function decodeLocationActivityCursor(
  value: string | null | undefined
): LocationActivityCursor | null {
  return decodeCursor(value, locationActivityCursorSchema)
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One `gbp_management_mutation` row as the activity panel sees it. */
export const locationActivityItemSchema = z.object({
  id: z.string(),
  sourceId: z.string().optional(),
  source: z.string().optional(),
  resourceType: z.string(),
  operation: z.string(),
  status: z.string(),
  targetResourceName: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  updateMask: z.array(z.string()),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorDisplayName: z.string().nullable(),
  historicalReason: z.string().optional(),
  executionState: gbpExecutionStateSchema.optional(),
  confirmationState: gbpConfirmationStateSchema.optional(),
  canConfirm: z.boolean().optional(),
})
export type LocationActivityItem = z.infer<typeof locationActivityItemSchema>

export const locationActivityStateSchema = z.object({
  canManage: z.boolean().optional(),
  items: z.array(locationActivityItemSchema),
  /** Every recorded change for the location, not just this page. */
  total: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  /** Where the next page starts; `null` on the last page. */
  nextCursor: z.string().nullable().default(null),
})
export type LocationActivityState = z.infer<typeof locationActivityStateSchema>

export const locationActivityResponseSchema = z.object({
  activity: locationActivityStateSchema,
})
export type LocationActivityResponse = z.infer<
  typeof locationActivityResponseSchema
>
