/**
 * Wire contract for `/api/ai/credits` and the operator override and
 * adjustments. Client-safe.
 */
import { z } from "zod"

import { ACCESS_REASONS } from "@/lib/domain/entitlements"

/** The `ai_credit_period.kind` values a balance can come from. */
export const CREDIT_PERIOD_KINDS = [
  "pilot_month",
  "trial",
  "paid_period",
] as const
export type CreditPeriodKind = (typeof CREDIT_PERIOD_KINDS)[number]

/**
 * The organisation's AI draft balance in its current credit period
 * (`ai_credit_period`, plan P07). Every instant comes from the period row,
 * which the server reads against the database clock.
 */
export const aiCreditsSchema = z.object({
  used: z.number().int().min(0),
  /** null = unknown (no period yet, or one granted without an allowance). */
  allowance: z.number().int().min(0).nullable(),
  /** null when the allowance is unknown. */
  remaining: z.number().int().min(0).nullable(),
  periodId: z.uuid().nullable(),
  periodKind: z.enum(CREDIT_PERIOD_KINDS).nullable(),
  /** ISO timestamps of the period; null with no period. */
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  /** False while billing derives read-only: no new AI work at all. */
  canUseAi: z.boolean(),
  accessReason: z.enum(ACCESS_REASONS),
})
export type AiCredits = z.infer<typeof aiCreditsSchema>

/** `details` of the 402 `ai_credits_exhausted` error. */
export const aiCreditsExhaustedDetailsSchema = z.object({
  used: z.number().int().min(0),
  allowance: z.number().int().min(0),
  /** The period end (ISO). */
  resetsAt: z.string(),
})

/**
 * A pilot's calendar-month allowance. null clears the override and falls
 * back to the environment default. Only pilot months read it; a trial or
 * paid period takes its allowance from billing, plus any adjustments.
 */
export const aiCreditsOverrideInputSchema = z.object({
  monthlyDraftCredits: z.number().int().min(0).max(1_000_000).nullable(),
})
export type AiCreditsOverrideInput = z.infer<
  typeof aiCreditsOverrideInputSchema
>

export const aiCreditsOrganisationParamsSchema = z.object({ id: z.uuid() })

/**
 * An operator grant of extra draft credits for the organisation's current
 * credit period (plan P07-S7, `ai_credit_period` kind 'adjustment'). The
 * operator route authenticates with the shared cron bearer, which carries no
 * identity, so the operator names themself. `reference` (a support ticket
 * id, for example) makes the grant idempotent: the same reference never
 * grants twice for one organisation.
 */
export const aiCreditAdjustmentInputSchema = z.object({
  credits: z.number().int().min(1).max(100_000),
  reason: z.string().trim().min(10).max(500),
  operator: z.string().trim().min(3).max(120),
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
})
export type AiCreditAdjustmentInput = z.infer<
  typeof aiCreditAdjustmentInputSchema
>

/** One recorded grant, as the operator history shows it. */
export const aiCreditAdjustmentSchema = z.object({
  id: z.uuid(),
  /** The base period the grant adds to. */
  periodId: z.uuid(),
  periodKind: z.enum(CREDIT_PERIOD_KINDS),
  credits: z.number().int().min(1),
  reason: z.string(),
  operator: z.string(),
  reference: z.string(),
  /** ISO timestamps: when it was granted, and when its period ends. */
  createdAt: z.string(),
  periodEnd: z.string(),
  /** True while its period is the organisation's current one. */
  current: z.boolean(),
})
export type AiCreditAdjustment = z.infer<typeof aiCreditAdjustmentSchema>

/** The operator view: the balance plus the grant history, newest first. */
export const aiCreditsOperatorViewSchema = z.object({
  credits: aiCreditsSchema,
  adjustments: z.array(aiCreditAdjustmentSchema),
})
export type AiCreditsOperatorView = z.infer<typeof aiCreditsOperatorViewSchema>

/** The answer to a grant: the adjustment, and whether it was already recorded. */
export const aiCreditAdjustmentResultSchema =
  aiCreditsOperatorViewSchema.extend({
    adjustment: aiCreditAdjustmentSchema,
    replayed: z.boolean(),
  })
export type AiCreditAdjustmentResult = z.infer<
  typeof aiCreditAdjustmentResultSchema
>

/** Credits spent per UTC day of the current credit period, for the usage chart. */
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

/** "1 Nov" in UTC, matching the UTC period boundaries. */
export function formatResetDate(resetsAt: string): string {
  return new Date(resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

type CreditsCopyInput = Pick<
  AiCredits,
  "remaining" | "allowance" | "periodEnd" | "periodKind" | "canUseAi"
>

/**
 * True when Generate must stay off: billing is read-only, the allowance is
 * unknown, or nothing is left. Manual replies are unaffected.
 */
export function aiCreditsBlocked(credits: CreditsCopyInput): boolean {
  return (
    !credits.canUseAi || credits.remaining === null || credits.remaining <= 0
  )
}

/** "this month" for a pilot calendar month, "this period" otherwise. */
export function creditPeriodNoun(kind: CreditPeriodKind | null): string {
  return kind === "pilot_month" ? "this month" : "this period"
}

/** "7 of 200 credits left this month" / the blocked sentences. */
export function describeCreditsLeft(credits: CreditsCopyInput): string {
  if (!credits.canUseAi) {
    return "AI drafting is unavailable while this workspace's subscription is read-only. You can still write a reply yourself."
  }
  if (credits.allowance === null || credits.remaining === null) {
    return "Your AI credit allowance is not confirmed yet, so AI drafting is off for now. You can still write a reply yourself."
  }
  if (credits.remaining <= 0) {
    return credits.periodEnd
      ? `Out of AI credits until ${formatResetDate(credits.periodEnd)}. You can still write a reply yourself.`
      : "Out of AI credits. You can still write a reply yourself."
  }
  return `${credits.remaining} of ${credits.allowance} credits left ${creditPeriodNoun(credits.periodKind)}`
}
