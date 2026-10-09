"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchClientAccess, fetchMembers } from "@/lib/api/members"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useMembers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: (ctx) => fetchMembers(requestOptions(ctx)),
    enabled,
  })
}

/** One member's access by client, for the Client access dialog. */
export function useClientAccess(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberClientAccess(userId ?? "none"),
    queryFn: (ctx) => fetchClientAccess(userId!, requestOptions(ctx)),
    enabled: Boolean(userId),
  })
}
