import { aiCreditsSchema } from "@/lib/contracts/ai-credits"

import { ApiClientError, apiFetch } from "./client"

export type { AiCredits } from "@/lib/contracts/ai-credits"

export function getAiCredits() {
  return apiFetch("/api/ai/credits", { schema: aiCreditsSchema })
}

/**
 * True for the 402 the draft route answers when the month's allowance is
 * spent, so the composer can tell it apart from `drafts_paused`.
 */
export function isAiCreditsExhausted(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError && error.code === "ai_credits_exhausted"
  )
}
