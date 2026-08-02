"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPrivacyRequests } from "@/lib/api/privacy"
import { queryKeys } from "./keys"

export function usePrivacyRequests() {
  return useQuery({ queryKey: queryKeys.privacyRequests, queryFn: fetchPrivacyRequests, staleTime: 30_000 })
}
