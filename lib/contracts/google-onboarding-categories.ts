import { z } from "zod"
import { googleOnboardingPayloadSchema } from "./google-onboarding"

export const onboardingCategoryQuerySchema = z
  .object({
    connectionId: z.uuid(),
    clientId: z.uuid().optional(),
    regionCode: z.string().regex(/^[A-Z]{2}$/),
    languageCode: googleOnboardingPayloadSchema.shape.languageCode.unwrap(),
    query: z.string().trim().min(1).max(100),
    pageToken: z.string().min(1).max(4096).optional(),
  })
  .strict()

export const onboardingCategoryPageSchema = z
  .object({
    categories: z
      .array(
        z.object({
          name: z.string().regex(/^categories\/[^/\s]+$/),
          displayName: z.string().trim().min(1),
        })
      )
      .max(100)
      .default([]),
    nextPageToken: z.string().max(4096).optional(),
  })
  .strict()

export type OnboardingCategoryQuery = z.infer<
  typeof onboardingCategoryQuerySchema
>
