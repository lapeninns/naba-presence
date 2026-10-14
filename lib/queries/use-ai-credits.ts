"use client"

import { useQuery } from "@tanstack/react-query"

import { getAiCredits, getAiCreditsDaily } from "@/lib/api/ai-credits"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAiCredits() {
  return useQuery({
    queryKey: queryKeys.aiCredits,
    queryFn: (ctx) => getAiCredits(requestOptions(ctx)),
  })
}

export function useAiCreditsDaily() {
  return useQuery({
    queryKey: queryKeys.aiCreditsDaily,
    queryFn: (ctx) => getAiCreditsDaily(requestOptions(ctx)),
  })
}
