import { z } from "zod"
import { gbpMutationResultSchema } from "./gbp-management"

export const lodgingAttemptSchema = gbpMutationResultSchema.extend({
  reviewId: z.uuid(), targetResourceName: z.string(),
  executionState: z.enum(["unrecorded", "pending", "accepted", "rejected", "unknown"]),
  confirmationState: z.enum(["unrecorded", "pending", "confirmed", "unresolved"]),
  createdAt: z.iso.datetime(), observedAt: z.iso.datetime().nullable(), errorCode: z.string().nullable(),
})
export const lodgingAttemptResponseSchema = z.object({ attempt: lodgingAttemptSchema })
export type LodgingAttempt = z.infer<typeof lodgingAttemptSchema>
