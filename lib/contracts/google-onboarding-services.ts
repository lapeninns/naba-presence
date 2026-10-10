import { z } from "zod"
import { googleServiceCategorySchema } from "@/lib/domain/google-services"

export const onboardingServicesQuerySchema = z.object({
  expectedRevision: z.coerce.number().int().min(1),
}).strict()

export const onboardingServicesResponseSchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().min(1),
  payloadHash: z.string().length(64),
  categories: z.array(googleServiceCategorySchema).min(1).max(10),
  regionCode: z.string().regex(/^[A-Z]{2}$/),
  languageCode: z.string().min(2).max(35),
  observedAt: z.iso.datetime(),
}).strict()

export type OnboardingServicesResponse = z.infer<typeof onboardingServicesResponseSchema>
