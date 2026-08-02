"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchInvitations } from "@/lib/api/invitations"
import { queryKeys } from "./keys"

export function useInvitations() {
  return useQuery({ queryKey: queryKeys.invitations, queryFn: fetchInvitations, staleTime: 30_000 })
}
