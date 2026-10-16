// Pure display helpers for the AI credit balance. Zod-free on purpose: the
// inbox composer and the usage card import this file so the schemas in
// `lib/contracts/ai-credits.ts` stay out of their first load. That file
// re-exports everything here under the same names.

import type { AiCredits, CreditPeriodKind } from "@/lib/contracts/ai-credits"

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
