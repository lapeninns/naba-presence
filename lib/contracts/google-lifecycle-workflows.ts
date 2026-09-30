import { z } from "zod"
import { googleLifecycleRequestSchema } from "./google-lifecycle"

export const lifecycleWorkflowCursorSchema = z.strictObject({ locationId: z.uuid(), createdAt: z.iso.datetime(), id: z.uuid() })
export const lifecycleWorkflowsQuerySchema = z.strictObject({
  cursor: z.string().max(1000).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const lifecycleWorkflowSchema = z.strictObject({
  reviewId: z.uuid(), createdAt: z.iso.datetime(), request: googleLifecycleRequestSchema,
  attemptId: z.uuid().nullable(),
})
export const lifecycleWorkflowsResponseSchema = z.strictObject({ items: z.array(lifecycleWorkflowSchema), nextCursor: z.string().nullable() })
export type LifecycleWorkflow = z.infer<typeof lifecycleWorkflowSchema>
