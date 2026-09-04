"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMembers } from "@/lib/api/members"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useMembers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: (ctx) => fetchMembers(requestOptions(ctx)),
    enabled,
  })
}
