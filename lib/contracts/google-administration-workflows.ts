import { z } from "zod"
import { administrationAccessRequestSchema } from "./google-administration-review"

export const administrationWorkflowCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() })
export const administrationWorkflowsQuerySchema = z.object({
  cursor: z.string().max(1000).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const administrationWorkflowSchema = z.object({
  reviewId: z.uuid(), createdAt: z.iso.datetime(), request: administrationAccessRequestSchema,
  attemptId: z.uuid().nullable(), executionState: z.string().nullable(), confirmationState: z.string().nullable(),
})
export const administrationWorkflowsResponseSchema = z.object({ items: z.array(administrationWorkflowSchema), nextCursor: z.string().nullable() })
export type AdministrationWorkflow = z.infer<typeof administrationWorkflowSchema>
