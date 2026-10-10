/**
 * Wire contract for GET `/api/locations/[id]/activity`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the route
 * (query schema), `lib/api/location-activity.ts` (response schema) and
 * `lib/server/location-activity.ts` (the item/state types).
 */
import { z } from "zod"
import { gbpExecutionStateSchema, gbpConfirmationStateSchema } from "./gbp-management"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** GET `/activity` query (`page`/`pageSize` arrive as strings). */
export const locationActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  cursor: z.string().max(1024).optional(),
})
export type LocationActivityQuery = z.infer<typeof locationActivityQuerySchema>

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
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  nextCursor: z.string().nullable().optional(),
})
export type LocationActivityState = z.infer<typeof locationActivityStateSchema>

export const locationActivityResponseSchema = z.object({
  activity: locationActivityStateSchema,
})
export type LocationActivityResponse = z.infer<
  typeof locationActivityResponseSchema
>
