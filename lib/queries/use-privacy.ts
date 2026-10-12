"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchLegalHolds,
  fetchPrivacyRequests,
  fetchRetentionStatus,
} from "@/lib/api/privacy"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function usePrivacyRequests() {
  return useQuery({
    queryKey: queryKeys.privacyRequests,
    queryFn: (ctx) => fetchPrivacyRequests(requestOptions(ctx)),
  })
}

export function useLegalHolds() {
  return useQuery({
    queryKey: queryKeys.legalHolds,
    queryFn: (ctx) => fetchLegalHolds(requestOptions(ctx)),
  })
}

export function useRetentionStatus() {
  return useQuery({
    queryKey: queryKeys.retentionStatus,
    queryFn: (ctx) => fetchRetentionStatus(requestOptions(ctx)),
  })
}
