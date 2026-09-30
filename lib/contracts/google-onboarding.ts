import { z } from "zod"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { googleOnboardingMoreHoursSchema, googleOnboardingRegularHoursSchema, googleOnboardingSpecialHoursSchema } from "@/lib/domain/google-onboarding-hours"

export const googleAccountMatchInputSchema = z.object({
  connectionId: z.uuid(),
  clientId: z.uuid().optional(),
  pageSize: z.number().int().min(1).max(10).default(10),
  search: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("query"), query: z.string().trim().min(1).max(1000) }).strict(),
    z.object({ kind: z.literal("location"), location: businessInformationPayloadSchema.refine((location) => Boolean(location.title), "Provide a business name when matching location details.") }).strict(),
  ]),
}).strict()
export type GoogleAccountMatchInput = z.infer<typeof googleAccountMatchInputSchema>

export const googleLocationMatchSchema = z.object({
  name: z.string().regex(/^googleLocations\/[^/\s]+$/),
  location: z.looseObject({
    name: z.string().regex(/^locations\/[^/\s]+$/).optional(),
    title: z.string().optional(),
    storefrontAddress: z.looseObject({
      regionCode: z.string().optional(), addressLines: z.array(z.string()).optional(),
      locality: z.string().optional(), postalCode: z.string().optional(),
    }).optional(),
  }),
  requestAdminRightsUri: z.url().refine((value) => new URL(value).protocol === "https:", "An ownership handoff must use HTTPS.").or(z.literal("")).optional(),
})

export const googleLocationSearchResultSchema = z.object({
  googleLocations: z.array(googleLocationMatchSchema).max(10).optional(),
}).strict()

export const googleAccountMatchesResponseSchema = z.object({
  accountId: z.uuid(), connectionId: z.uuid(), checkedAt: z.iso.datetime(),
  matches: z.array(googleLocationMatchSchema).max(10),
})
export type GoogleAccountMatchesResponse = z.infer<typeof googleAccountMatchesResponseSchema>

export const googleOnboardingPayloadSchema = businessInformationPayloadSchema.extend({
  regularHours: googleOnboardingRegularHoursSchema.optional(),
  specialHours: googleOnboardingSpecialHoursSchema.optional(),
  moreHours: googleOnboardingMoreHoursSchema.optional(),
  languageCode: z.string().trim().min(2).max(35).refine((value) => {
    try { return Intl.getCanonicalLocales(value).length === 1 } catch { return false }
  }, "Use a valid language tag, such as en-GB.").optional(),
}).refine((payload) => !payload.specialHours || Boolean(payload.regularHours), "Special hours require proposed regular hours.")

export const googleOnboardingDraftCreateSchema = z.object({
  draftId: z.uuid(),
  connectionId: z.uuid(),
  clientId: z.uuid().optional(),
  payload: googleOnboardingPayloadSchema,
}).strict()

export const googleOnboardingDraftSaveSchema = z.object({
  expectedRevision: z.number().int().min(1),
  payload: googleOnboardingPayloadSchema,
}).strict()

export const googleOnboardingDraftMatchSchema = z.object({
  expectedRevision: z.number().int().min(1),
}).strict()

export const googleOnboardingDraftSchema = z.object({
  id: z.uuid(), accountId: z.uuid(), accountName: z.string(), connectionId: z.uuid(),
  clientId: z.uuid().nullable(), requestedBy: z.uuid(), providerRequestId: z.uuid(),
  revision: z.number().int().min(1), payload: googleOnboardingPayloadSchema,
  payloadHash: z.string(), matchResult: googleAccountMatchesResponseSchema.nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
})
export type GoogleOnboardingDraft = z.infer<typeof googleOnboardingDraftSchema>
export const googleOnboardingDraftListInputSchema = z.object({ connectionId: z.uuid(), clientId: z.uuid().optional() }).strict()
export const googleOnboardingDraftListSchema = z.object({ drafts: z.array(googleOnboardingDraftSchema).max(20) })

export const googleOnboardingCreateDecisionSchema = z.object({
  action: z.literal("create_new"),
  acknowledgedMatchNames: z.array(z.string().regex(/^googleLocations\/[^/\s]+$/)).max(10).refine((names) => new Set(names).size === names.length, "Acknowledge each match once."),
  reason: z.string().trim().min(1).max(1000),
}).strict()

export const googleOnboardingReviewInputSchema = z.object({
  expectedRevision: z.number().int().min(1),
  expectedMatchCheckedAt: z.iso.datetime(),
  decision: googleOnboardingCreateDecisionSchema,
}).strict()

export const googleOnboardingApproveInputSchema = z.object({
  expectedReviewHash: z.string().length(64),
}).strict()

export const googleOnboardingReviewSchema = z.object({
  id: z.uuid(), draftId: z.uuid(), revision: z.number().int().min(1),
  accountId: z.uuid(), accountName: z.string(), connectionId: z.uuid(), clientId: z.uuid().nullable(),
  providerRequestId: z.uuid(), payload: googleOnboardingPayloadSchema,
  matchResult: googleAccountMatchesResponseSchema, decision: googleOnboardingCreateDecisionSchema,
  reviewHash: z.string().length(64), requestedBy: z.uuid(), approvedBy: z.uuid().nullable(),
  requiresSecondApprover: z.boolean(), canApprove: z.boolean(),
  validatedAt: z.iso.datetime(), approvalExpiresAt: z.iso.datetime(),
})
export type GoogleOnboardingReview = z.infer<typeof googleOnboardingReviewSchema>

export const googleOnboardingSubmitSchema = googleOnboardingApproveInputSchema.extend({ reviewId: z.uuid() }).strict()
export const googleOnboardingLinkSchema = z.object({ localName: z.string().trim().min(1).max(255) }).strict()
export const googleOnboardingCreationSchema = z.object({
  id: z.uuid(), draftId: z.uuid(), reviewId: z.uuid(),
  executionState: z.enum(["pending", "accepted", "rejected", "unknown"]),
  confirmationState: z.enum(["pending", "confirmed", "unresolved"]),
  linkState: z.enum(["pending", "linked", "failed"]),
  providerResourceName: z.string().nullable(), locationId: z.uuid().nullable(),
  errorCode: z.string().nullable(), updatedAt: z.iso.datetime(),
})
export type GoogleOnboardingCreation = z.infer<typeof googleOnboardingCreationSchema>
