import { z } from "zod"
import { onboardingAccessibleMatchesQuerySchema } from "./google-onboarding-accessible-matches"

export const onboardingMatchLinkInputSchema = onboardingAccessibleMatchesQuerySchema.extend({
  matchName: z.string().regex(/^googleLocations\/[^/\s]+$/),
  localName: z.string().trim().min(1).max(200),
}).strict()

export const onboardingMatchLinkProviderSchema = z.object({
  name: z.string().regex(/^locations\/[^/\s]+$/),
  title: z.string().trim().min(1),
  placeId: z.string().min(1).optional(),
  address: z.record(z.string(), z.unknown()).nullable(),
  verified: z.boolean().nullable(),
}).strict()

export const onboardingMatchLinkFrozenSchema = z.object({
  draftId: z.uuid(), revision: z.number().int().min(1), payloadHash: z.string().length(64),
  accountId: z.uuid(), accountName: z.string().regex(/^accounts\/[^/\s]+$/),
  connectionId: z.uuid(), clientId: z.uuid().nullable(),
  matchCheckedAt: z.iso.datetime(), matchName: z.string().regex(/^googleLocations\/[^/\s]+$/),
  provider: onboardingMatchLinkProviderSchema,
  localName: z.string().min(1).max(200), externalLocationId: z.uuid().nullable(),
  conflicts: z.array(z.enum(["external_assignment", "existing_link", "local_name", "webhook_assignment"])).max(4),
}).strict()

export const onboardingMatchLinkReviewSchema = onboardingMatchLinkFrozenSchema.extend({
  id: z.uuid(), reviewHash: z.string().length(64),
  requestedBy: z.uuid(), approvedBy: z.uuid().nullable(),
  requiresSecondApprover: z.boolean(), canApprove: z.boolean(),
  observedAt: z.iso.datetime(), approvalExpiresAt: z.iso.datetime(),
}).strict()

export const onboardingMatchLinkApproveSchema = z.object({ expectedReviewHash: z.string().length(64) }).strict()
export type OnboardingMatchLinkInput = z.infer<typeof onboardingMatchLinkInputSchema>
export type OnboardingMatchLinkFrozen = z.infer<typeof onboardingMatchLinkFrozenSchema>

export const onboardingMatchLinkSubmitSchema = z.object({
  reviewId: z.uuid(), expectedReviewHash: z.string().length(64),
}).strict()
export const onboardingMatchLinkOperationSchema = z.object({
  id: z.uuid(), draftId: z.uuid(), reviewId: z.uuid(),
  state: z.enum(["pending", "linked", "failed"]),
  attemptGeneration: z.number().int().min(1),
  locationId: z.uuid().nullable(), externalLocationId: z.uuid().nullable(),
  errorCode: z.string().nullable(), updatedAt: z.iso.datetime(),
}).strict()
export type OnboardingMatchLinkOperation = z.infer<typeof onboardingMatchLinkOperationSchema>
