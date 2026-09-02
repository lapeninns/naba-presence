"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPrivacyRequests } from "@/lib/api/privacy"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function usePrivacyRequests() {
  return useQuery({ queryKey: queryKeys.privacyRequests, queryFn: (ctx) => fetchPrivacyRequests(requestOptions(ctx)) })
}
