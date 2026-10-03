/**
 * Wire contract for `/api/ai/credits` and the operator override. Client-safe.
 */
import { z } from "zod"

export const aiCreditsSchema = z.object({
  used: z.number().int().min(0),
  allowance: z.number().int().min(0),
  remaining: z.number().int().min(0),
  /** First day of the UTC month, `YYYY-MM-DD`. */
  periodStart: z.string(),
  /** ISO timestamp when the next period begins. */
  resetsAt: z.string(),
})
export type AiCredits = z.infer<typeof aiCreditsSchema>

/** `details` of the 402 `ai_credits_exhausted` error. */
export const aiCreditsExhaustedDetailsSchema = z.object({
  used: z.number().int().min(0),
  allowance: z.number().int().min(0),
  resetsAt: z.string(),
})

/** null clears the override and falls back to the environment default. */
export const aiCreditsOverrideInputSchema = z.object({
  monthlyDraftCredits: z.number().int().min(0).max(1_000_000).nullable(),
})
export type AiCreditsOverrideInput = z.infer<
  typeof aiCreditsOverrideInputSchema
>

export const aiCreditsOrganisationParamsSchema = z.object({ id: z.uuid() })
