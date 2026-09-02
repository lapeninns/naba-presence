/**
 * Wire contract for GET `/api/locations/[id]/activity`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the route
 * (query schema), `lib/api/location-activity.ts` (response schema) and
 * `lib/server/location-activity.ts` (the item/state types).
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** GET `/activity` query (`page`/`pageSize` arrive as strings). */
export const locationActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
})
export type LocationActivityQuery = z.infer<typeof locationActivityQuerySchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One `gbp_management_mutation` row as the activity panel sees it. */
export const locationActivityItemSchema = z.object({
  id: z.string(),
  resourceType: z.string(),
  operation: z.string(),
  status: z.string(),
  targetResourceName: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  updateMask: z.array(z.string()),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  actorUserId: z.string(),
  actorDisplayName: z.string().nullable(),
})
export type LocationActivityItem = z.infer<typeof locationActivityItemSchema>

export const locationActivityStateSchema = z.object({
  items: z.array(locationActivityItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
export type LocationActivityState = z.infer<typeof locationActivityStateSchema>

export const locationActivityResponseSchema = z.object({
  activity: locationActivityStateSchema,
})
export type LocationActivityResponse = z.infer<
  typeof locationActivityResponseSchema
>
