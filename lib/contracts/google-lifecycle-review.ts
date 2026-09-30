import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"
import { googleAccountNameSchema } from "./google-administration-review"
import { googleLifecycleBaselineSchema, googleLifecycleRequestSchema } from "./google-lifecycle"

export const reviewedLifecyclePayloadSchema = z.strictObject({
  request: googleLifecycleRequestSchema,
  connectionId: z.uuid(), credentialGeneration: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
})
export const lifecycleReviewSchema = z.strictObject({
  changeSet: gbpChangeSetSchema,
  request: googleLifecycleRequestSchema,
  baseline: googleLifecycleBaselineSchema,
})
export type LifecycleReview = z.infer<typeof lifecycleReviewSchema>
export const lifecycleReviewResponseSchema = z.object({ review: lifecycleReviewSchema })
export const lifecycleApprovalSchema = z.strictObject({ expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/) })

export const lifecycleAttemptSchema = z.strictObject({
  id: z.uuid(), reviewId: z.uuid(), locationId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/), request: googleLifecycleRequestSchema,
  sourceAccount: googleAccountNameSchema,
  operation: z.enum(["transfer_location", "delete_location"]),
  target: z.string().regex(/^locations\/[A-Za-z0-9_-]+$/),
  executionState: z.enum(["unrecorded", "pending", "accepted", "rejected", "unknown"]),
  confirmationState: z.enum(["unrecorded", "pending", "confirmed", "unresolved"]),
  localReconciliation: z.enum(["not_required", "pending", "applied", "conflict"]),
  postcondition: z.enum(["location_transferred_between_accounts", "location_absent_from_managed_account", "unresolved"]),
  observedAt: z.iso.datetime().nullable(), errorCode: z.string().nullable(), idempotent: z.boolean(),
})
export type LifecycleAttempt = z.infer<typeof lifecycleAttemptSchema>
export const lifecycleAttemptResponseSchema = z.object({ attempt: lifecycleAttemptSchema })
