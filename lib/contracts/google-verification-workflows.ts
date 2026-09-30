import { z } from "zod"
import { gbpConfirmationStateSchema, gbpExecutionStateSchema } from "./gbp-management"

export const verificationWorkflowQuerySchema = z.strictObject({
  operation: z.enum(["all", "start", "complete"]).default("all"),
  stage: z.enum(["all", "reviews", "attempts"]).default("all"),
  includeExpired: z.enum(["true", "false"]).default("false"),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
})
export type VerificationWorkflowQuery = z.infer<typeof verificationWorkflowQuerySchema>
export const verificationWorkflowItemSchema = z.object({
  reviewId: z.uuid(), createdAt: z.iso.datetime(),
  operation: z.enum(["start_verification", "complete_verification"]),
  method: z.enum(["EMAIL", "PHONE_CALL", "SMS", "ADDRESS", "AUTO", "UNKNOWN"]),
  payloadHash: z.string().length(64), requestedBy: z.uuid(), approvedBy: z.uuid().nullable(),
  requiresSecondApprover: z.boolean(), expiresAt: z.iso.datetime(), canApprove: z.boolean(),
  reviewReason: z.enum(["expired", "policy_changed", "actor_access_changed", "credential_changed", "reconnect_required", "review_unreadable", "publish_not_allowed"]).nullable(),
  attempt: z.object({
    id: z.uuid(), status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
    executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
    observedAt: z.iso.datetime().nullable(),
  }).nullable(),
})
export type VerificationWorkflowItem = z.infer<typeof verificationWorkflowItemSchema>
export const verificationWorkflowResponseSchema = z.object({
  workflows: z.array(verificationWorkflowItemSchema).max(50), nextCursor: z.string().nullable(),
})
export type VerificationWorkflowResponse = z.infer<typeof verificationWorkflowResponseSchema>
