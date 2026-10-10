import { z } from "zod"
import { gbpMutationResultSchema, gbpExecutionStateSchema, gbpConfirmationStateSchema } from "./gbp-management"

export const serviceAttemptSchema = gbpMutationResultSchema.extend({
  reviewId: z.uuid(), targetResourceName: z.string(),
  executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
  createdAt: z.iso.datetime(), observedAt: z.iso.datetime().nullable(), errorCode: z.string().nullable(),
})
export const serviceAttemptResponseSchema = z.object({ attempt: serviceAttemptSchema })
export type ServiceAttempt = z.infer<typeof serviceAttemptSchema>
