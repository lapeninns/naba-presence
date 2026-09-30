import { z } from "zod"

export const onboardingChainsQuerySchema = z.object({
  expectedRevision: z.coerce.number().int().min(1),
  query: z.string().trim().min(1).max(100),
}).strict()

export const onboardingChainsResponseSchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().min(1),
  payloadHash: z.string().length(64),
  query: z.string().min(1).max(100),
  choices: z.array(z.object({ name: z.string().regex(/^chains\/[^/\s]+$/), label: z.string().min(1) }).strict()).max(100),
}).strict()

export type OnboardingChainsQuery = z.infer<typeof onboardingChainsQuerySchema>
