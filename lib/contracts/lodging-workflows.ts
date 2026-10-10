import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"

export const lodgingWorkflowCursorSchema = z.object({ locationId: z.uuid(), createdAt: z.iso.datetime(), id: z.uuid() }).strict()
export const lodgingWorkflowsQuerySchema = z.object({ type: z.literal("workflows"), cursor: z.string().max(1000).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict()
export const lodgingWorkflowsResponseSchema = z.object({ items: z.array(z.object({ changeSet: gbpChangeSetSchema, attemptId: z.uuid().nullable() })), nextCursor: z.string().nullable() })
export type LodgingWorkflowQuery = z.infer<typeof lodgingWorkflowsQuerySchema>
