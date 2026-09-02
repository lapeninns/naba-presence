// Wire shapes shared by the GBP management surfaces (business information,
// industry, administration, booking). Client-safe: zod only.
import { z } from "zod"

/** Result of a GBP management mutation: the attempt row plus the idempotent flag. */
export const gbpMutationResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  idempotent: z.boolean(),
})
export type GbpMutationResult = z.infer<typeof gbpMutationResultSchema>

/**
 * A mutation whose Google response is echoed back (industry, administration).
 * `response` is freeform because each Google API returns its own resource.
 */
export const gbpMutationWithResponseResultSchema = gbpMutationResultSchema.extend({
  response: z.unknown().optional(),
})
export type GbpMutationWithResponseResult = z.infer<
  typeof gbpMutationWithResponseResultSchema
>

/**
 * One optional Google sub-resource in a state bundle: the resource, or the
 * error that prevented loading it. Sub-resources are freeform (D8).
 */
export const sectionResultSchema = z.object({
  data: z.unknown(),
  error: z.string().nullable(),
})
export type SectionResult<T = unknown> = { data: T; error: string | null }
