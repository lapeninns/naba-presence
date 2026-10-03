"use client"

import { useQuery } from "@tanstack/react-query"

import { getAiCredits, getAiCreditsDaily } from "@/lib/api/ai-credits"
import { queryKeys } from "./keys"

export function useAiCredits() {
  return useQuery({
    queryKey: queryKeys.aiCredits,
    queryFn: () => getAiCredits(),
  })
}

export function useAiCreditsDaily() {
  return useQuery({
    queryKey: queryKeys.aiCreditsDaily,
    queryFn: () => getAiCreditsDaily(),
  })
}
