import { z } from "zod"
import { placeActionInputSchema } from "./location-place-actions"
import { placeActionNameSchema } from "./place-action-review"
export const placeActionBaselineSchema = z.object({
  collection: z.string(), supportedTypes: z.array(z.string()), unsupportedTypes: z.array(z.string()),
  links: z.array(z.object({ name: placeActionNameSchema, providerType: z.string(), isEditable: z.boolean(),
    ...placeActionInputSchema.shape, createTime: z.string().nullable(), updateTime: z.string().nullable() })),
  // Well-formed links whose action type this release does not model: read-only, managed in Google.
  unsupportedLinks: z.array(z.object({ name: placeActionNameSchema, providerType: z.string(), uri: z.string(), placeActionType: z.string() })).default([]),
})
