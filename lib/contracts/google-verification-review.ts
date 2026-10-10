import { z } from "zod"

import { gbpChangeSetSchema } from "./gbp-change-set"
import { verificationChoiceSchema, verificationStartPayloadSchema } from "./google-verification-options"

export const verificationReviewInputSchema = z.strictObject({ optionId: z.string().length(64), payload: verificationStartPayloadSchema })
export type VerificationReviewInput = z.infer<typeof verificationReviewInputSchema>
export const verificationReviewApprovalSchema = z.strictObject({ expectedPayloadHash: z.string().length(64) })
export const verificationReviewSchema = z.object({ changeSet: gbpChangeSetSchema, choice: verificationChoiceSchema, payload: verificationStartPayloadSchema })
export type VerificationReview = z.infer<typeof verificationReviewSchema>
export const verificationReviewResponseSchema = z.object({ review: verificationReviewSchema })
