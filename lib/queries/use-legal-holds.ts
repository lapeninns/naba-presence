"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLegalHolds } from "@/lib/api/legal-holds"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useLegalHolds() {
  return useQuery({ queryKey: queryKeys.legalHolds, queryFn: (ctx) => fetchLegalHolds(requestOptions(ctx)) })
}
