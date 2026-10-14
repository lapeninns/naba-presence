import {
  aiCreditsDailySchema,
  aiCreditsSchema,
} from "@/lib/contracts/ai-credits"

import { ApiClientError, apiFetch, type RequestOptions } from "./client"

export type { AiCredits } from "@/lib/contracts/ai-credits"

export function getAiCreditsDaily(options?: RequestOptions) {
  return apiFetch("/api/ai/credits/daily", {
    schema: aiCreditsDailySchema,
    ...options,
  })
}

export function getAiCredits(options?: RequestOptions) {
  return apiFetch("/api/ai/credits", { schema: aiCreditsSchema, ...options })
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
