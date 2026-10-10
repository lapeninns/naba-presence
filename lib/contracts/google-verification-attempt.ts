import { z } from "zod"
import { gbpConfirmationStateSchema, gbpExecutionStateSchema } from "./gbp-management"
import { observedMerchantStateSchema, observedVerificationSchema } from "./google-verification-state"
import { verificationCompletionInputSchema } from "./google-verification-completion-review"

export const verificationExecuteSchema = z.strictObject({
  expectedPayloadHash: z.string().length(64),
  confirmation: z.literal("start_google_location_verification"),
})
export const verificationCompletionExecuteSchema = z.strictObject({
  expectedPayloadHash: z.string().length(64),
  confirmation: z.literal("complete_google_location_verification"),
  pin: verificationCompletionInputSchema.shape.pin,
})
export const verificationAttemptSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), payloadHash: z.string().length(64),
  status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
  executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
  operation: z.enum(["start_verification", "complete_verification"]).optional(),
  idempotent: z.boolean(), verification: observedVerificationSchema.nullable(),
  merchant: observedMerchantStateSchema.nullable(), observedAt: z.iso.datetime().nullable(),
  error: z.enum(["start_rejected", "completion_rejected", "verification_failed", "outcome_unresolved", "refresh_unavailable"]).nullable(),
})
export const verificationAttemptResponseSchema = z.object({ attempt: verificationAttemptSchema })
export type VerificationAttempt = z.infer<typeof verificationAttemptSchema>
