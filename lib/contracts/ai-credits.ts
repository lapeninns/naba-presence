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

/** Credits spent per UTC day of the current period, for the usage chart. */
export const aiCreditsDailySchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      credits: z.number().int().min(0),
    })
  ),
})
export type AiCreditsDaily = z.infer<typeof aiCreditsDailySchema>

/**
 * One entry per day from the period's first day to `today` (inclusive), zero
 * where nothing was spent. Pure; shared by the server and the chart.
 */
export function fillDailyCredits(
  periodStart: string,
  today: string,
  rows: { date: string; credits: number }[]
): { date: string; credits: number }[] {
  const byDate = new Map(rows.map((row) => [row.date, row.credits]))
  const out: { date: string; credits: number }[] = []
  const end = Date.parse(`${today}T00:00:00Z`)
  for (
    let t = Date.parse(`${periodStart}T00:00:00Z`);
    t <= end;
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    out.push({ date, credits: byDate.get(date) ?? 0 })
  }
  return out
}

/** "1 Nov" in UTC, matching the UTC billing period. */
export function formatResetDate(resetsAt: string): string {
  return new Date(resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/** "7 of 200 credits left this month" / the exhausted sentence. */
export function describeCreditsLeft(credits: {
  remaining: number
  allowance: number
  resetsAt: string
}): string {
  if (credits.remaining <= 0) {
    return `Out of AI credits until ${formatResetDate(credits.resetsAt)}. You can still write a reply yourself.`
  }
  return `${credits.remaining} of ${credits.allowance} credits left this month`
}
