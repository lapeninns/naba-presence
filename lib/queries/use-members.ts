"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMembers } from "@/lib/api/members"
import { queryKeys } from "./keys"

export function useMembers() {
  return useQuery({ queryKey: queryKeys.members, queryFn: fetchMembers, staleTime: 30_000 })
}
