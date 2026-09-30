import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"
import { observedVerificationSchema } from "./google-verification-state"

export const verificationCompletionInputSchema = z.strictObject({
  name: z.string().max(512).regex(/^locations\/[A-Za-z0-9_-]+\/verifications\/[A-Za-z0-9_-]+$/),
  pin: z.string().trim().min(1).max(128),
})
export type VerificationCompletionInput = z.infer<typeof verificationCompletionInputSchema>
export const verificationCompletionPayloadSchema = z.strictObject({
  name: verificationCompletionInputSchema.shape.name,
  method: z.enum(["EMAIL", "PHONE_CALL", "SMS", "ADDRESS"]),
  credentialBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const verificationCompletionReviewSchema = z.object({
  changeSet: gbpChangeSetSchema,
  verification: observedVerificationSchema,
  payload: verificationCompletionPayloadSchema,
})
export type VerificationCompletionReview = z.infer<typeof verificationCompletionReviewSchema>
export const verificationCompletionReviewResponseSchema = z.object({ review: verificationCompletionReviewSchema })
