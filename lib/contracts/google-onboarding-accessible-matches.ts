import { z } from "zod"

export const onboardingAccessibleMatchesQuerySchema = z.object({
  expectedRevision: z.coerce.number().int().min(1),
  expectedMatchCheckedAt: z.iso.datetime(),
}).strict()

export const onboardingAccessibleLocationSchema = z.object({
  name: z.string().regex(/^locations\/[^/\s]+$/),
  title: z.string().optional(),
  placeId: z.string().min(1).optional(),
}).strict()

const matchName = z.string().regex(/^googleLocations\/[^/\s]+$/)
export const onboardingAccessibleMatchSchema = z.discriminatedUnion("status", [
  z.object({ matchName, status: z.literal("accessible"), location: onboardingAccessibleLocationSchema }).strict(),
  z.object({ matchName, status: z.enum(["not_accessible", "identity_unconfirmed", "ambiguous"]) }).strict(),
])

export const onboardingAccessibleMatchesResponseSchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().min(1),
  payloadHash: z.string().length(64),
  matchCheckedAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
  matches: z.array(onboardingAccessibleMatchSchema).max(10),
}).strict()

export type OnboardingAccessibleMatchesQuery = z.infer<typeof onboardingAccessibleMatchesQuerySchema>
export type OnboardingAccessibleMatch = z.infer<typeof onboardingAccessibleMatchSchema>
export type OnboardingAccessibleLocation = z.infer<typeof onboardingAccessibleLocationSchema>
