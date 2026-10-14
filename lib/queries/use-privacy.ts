"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchLegalHolds,
  fetchPrivacyPreview,
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

/**
 * The match counts an erasure's confirm step shows; `id` null while no
 * erasure is being confirmed. Never served from cache: the fulfil must carry
 * the confirmation for the match set as it is now.
 */
export function usePrivacyPreview(id: string | null) {
  return useQuery({
    queryKey: queryKeys.privacyPreview(id ?? ""),
    queryFn: (ctx) => fetchPrivacyPreview(id!, requestOptions(ctx)),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
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
