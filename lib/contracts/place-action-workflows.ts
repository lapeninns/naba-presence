import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"
export const placeActionWorkflowCursorSchema = z.strictObject({ locationId: z.uuid(), createdAt: z.iso.datetime(), id: z.uuid() })
export const placeActionWorkflowsQuerySchema = z.strictObject({ cursor: z.string().max(1000).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) })
export const placeActionWorkflowsResponseSchema = z.object({ items: z.array(z.object({ changeSet: gbpChangeSetSchema, attemptId: z.uuid().nullable() })), nextCursor: z.string().nullable() })
export type PlaceActionWorkflowQuery = z.infer<typeof placeActionWorkflowsQuerySchema>
