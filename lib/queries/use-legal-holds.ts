"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLegalHolds } from "@/lib/api/legal-holds"
import { queryKeys } from "./keys"

export function useLegalHolds() {
  return useQuery({ queryKey: queryKeys.legalHolds, queryFn: fetchLegalHolds, staleTime: 30_000 })
}
