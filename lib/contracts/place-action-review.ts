import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"
import { placeActionInputSchema } from "./location-place-actions"

export const placeActionNameSchema = z.string().regex(/^locations\/[A-Za-z0-9_-]+\/placeActionLinks\/[A-Za-z0-9_-]+$/)
export const placeActionRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create"), payload: placeActionInputSchema }),
  z.strictObject({ operation: z.literal("update"), name: placeActionNameSchema, payload: placeActionInputSchema }),
  z.strictObject({ operation: z.literal("delete"), name: placeActionNameSchema }),
])
export type ReviewedPlaceActionRequest = z.infer<typeof placeActionRequestSchema>
export const reviewedPlaceActionPayloadSchema = z.strictObject({
  request: placeActionRequestSchema, connectionId: z.uuid(),
  credentialGeneration: z.number().int().nonnegative(), observedAt: z.iso.datetime(),
})
export const placeActionReviewSchema = z.object({
  changeSet: gbpChangeSetSchema, request: placeActionRequestSchema,
  target: z.string(), observedAt: z.iso.datetime(),
})
export type PlaceActionReview = z.infer<typeof placeActionReviewSchema>
export const placeActionApprovalSchema = z.strictObject({ expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/) })
export const placeActionAttemptSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), locationId: z.uuid(), target: z.string(), payloadHash: z.string(),
  request: placeActionRequestSchema,
  executionState: z.enum(["unrecorded", "pending", "accepted", "rejected", "unknown"]),
  confirmationState: z.enum(["unrecorded", "pending", "confirmed", "unresolved"]),
  observedAt: z.iso.datetime().nullable(), errorCode: z.string().nullable(), idempotent: z.boolean(),
})
export type PlaceActionAttempt = z.infer<typeof placeActionAttemptSchema>
export const placeActionReviewResponseSchema = z.object({ review: placeActionReviewSchema })
export const placeActionAttemptResponseSchema = z.object({ attempt: placeActionAttemptSchema })
